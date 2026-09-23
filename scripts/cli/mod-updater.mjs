#!/usr/bin/env node
/**
 * Standalone CLI: automatically updates mods in a real, on-disk modpack
 * "mods/" folder by hash-matching each installed .jar against Modrinth and
 * fetching the latest version compatible with a given game version + loader.
 *
 * This intentionally has zero npm dependencies (uses only Node 20+ builtins:
 * fetch, fs/promises, crypto) so it can run directly with `node`, without
 * needing the Next.js app to be built or a ts-node/tsx toolchain installed.
 *
 * Only mods that are mirrored on Modrinth can be identified and updated this
 * way. CurseForge-exclusive mods (not published to Modrinth) are reported as
 * "not found" so you know to update them manually.
 *
 * Usage:
 *   node scripts/cli/mod-updater.mjs --dir /path/to/instance/mods \
 *     --game-version 1.20.1 --loader fabric [--dry-run]
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, rename, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const MODRINTH_API = "https://api.modrinth.com/v2";
const USER_AGENT = "MinecraftModInspector-CLI/1.0.0 (github.com/YOUTBMAT/minecraft-mod-inspector)";
const HASH_BATCH_SIZE = 100;

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dir") {
      args.dir = argv[++i];
    } else if (arg === "--game-version") {
      args.gameVersion = argv[++i];
    } else if (arg === "--loader") {
      args.loader = argv[++i]?.toLowerCase();
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Minecraft Mod Inspector - automatic mod updater

Usage:
  node scripts/cli/mod-updater.mjs --dir <mods_folder> --game-version <mc_version> --loader <fabric|forge|neoforge|quilt> [--dry-run]

Options:
  --dir           Path to the modpack's "mods" folder (required)
  --game-version  Target Minecraft version, e.g. 1.20.1 (required)
  --loader        Mod loader: fabric, forge, neoforge or quilt (required)
  --dry-run       Only report what would change, without downloading or replacing files
  -h, --help      Show this help

Notes:
  - Only mods published on Modrinth can be identified and updated automatically.
  - Replaced jars are moved into "<mods_folder>/.mod-inspector-backups/<timestamp>/" instead of being deleted.
`);
}

async function sha1File(filePath) {
  const buffer = await readFile(filePath);
  return createHash("sha1").update(buffer).digest("hex");
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function lookupVersionsByHash(hashes) {
  const result = new Map();
  for (const batch of chunk(hashes, HASH_BATCH_SIZE)) {
    const response = await fetch(`${MODRINTH_API}/version_files`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ hashes: batch, algorithm: "sha1" }),
    });

    if (!response.ok) {
      throw new Error(`Modrinth version_files lookup failed: HTTP ${response.status}`);
    }

    const body = await response.json();
    for (const [hash, version] of Object.entries(body)) {
      result.set(hash, version);
    }
  }
  return result;
}

async function fetchLatestVersion(projectId, gameVersion, loader) {
  const url = new URL(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version`);
  url.searchParams.set("game_versions", JSON.stringify([gameVersion]));
  url.searchParams.set("loaders", JSON.stringify([loader]));

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    return null;
  }

  const versions = await response.json();
  if (!Array.isArray(versions) || versions.length === 0) {
    return null;
  }

  return versions
    .slice()
    .sort((a, b) => new Date(b.date_published) - new Date(a.date_published))[0];
}

function pickPrimaryFile(version) {
  return version.files?.find((file) => file.primary) ?? version.files?.[0] ?? null;
}

async function downloadAndVerify(file) {
  const response = await fetch(file.url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Download failed (HTTP ${response.status}): ${file.url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const expectedSha1 = file.hashes?.sha1;
  if (expectedSha1) {
    const actualSha1 = createHash("sha1").update(buffer).digest("hex");
    if (actualSha1 !== expectedSha1) {
      throw new Error(
        `Downloaded file hash mismatch for ${file.filename}: expected ${expectedSha1}, got ${actualSha1}`,
      );
    }
  }
  return buffer;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const validLoaders = ["fabric", "forge", "neoforge", "quilt"];
  if (!args.dir || !args.gameVersion || !args.loader) {
    console.error("Missing required arguments.\n");
    printHelp();
    process.exitCode = 1;
    return;
  }
  if (!validLoaders.includes(args.loader)) {
    console.error(`Invalid --loader "${args.loader}". Expected one of: ${validLoaders.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const modsDir = path.resolve(args.dir);
  const dirStat = await stat(modsDir).catch(() => null);
  if (!dirStat || !dirStat.isDirectory()) {
    console.error(`"${modsDir}" is not a valid directory.`);
    process.exitCode = 1;
    return;
  }

  const entries = await readdir(modsDir);
  const jarFiles = entries.filter((name) => name.toLowerCase().endsWith(".jar"));

  if (jarFiles.length === 0) {
    console.log(`No .jar files found in ${modsDir}.`);
    return;
  }

  console.log(`Hashing ${jarFiles.length} mod file(s) in ${modsDir}...`);
  const jarHashes = new Map();
  for (const fileName of jarFiles) {
    const filePath = path.join(modsDir, fileName);
    jarHashes.set(fileName, await sha1File(filePath));
  }

  console.log("Identifying mods via Modrinth...");
  const versionByHash = await lookupVersionsByHash(Array.from(jarHashes.values()));

  const identified = [];
  const unmatched = [];
  for (const [fileName, hash] of jarHashes) {
    const version = versionByHash.get(hash);
    if (version) {
      identified.push({ fileName, hash, installedVersion: version });
    } else {
      unmatched.push(fileName);
    }
  }

  console.log(`Identified ${identified.length}/${jarFiles.length} mod(s) on Modrinth.`);
  if (unmatched.length > 0) {
    console.log(
      `\nCould not identify ${unmatched.length} file(s) (likely CurseForge-exclusive, renamed, or disabled) — update these manually:`,
    );
    unmatched.forEach((name) => console.log(`  - ${name}`));
  }

  const toUpdate = [];
  const upToDate = [];
  const noCompatibleVersion = [];

  for (const mod of identified) {
    const latest = await fetchLatestVersion(mod.installedVersion.project_id, args.gameVersion, args.loader);
    if (!latest) {
      noCompatibleVersion.push(mod);
      continue;
    }
    if (latest.id === mod.installedVersion.id) {
      upToDate.push(mod);
      continue;
    }
    toUpdate.push({ ...mod, latest });
  }

  console.log(`\n${upToDate.length} mod(s) already up to date.`);
  if (noCompatibleVersion.length > 0) {
    console.log(
      `${noCompatibleVersion.length} mod(s) have no version published for Minecraft ${args.gameVersion} / ${args.loader} — they may break on this version:`,
    );
    noCompatibleVersion.forEach((mod) => console.log(`  - ${mod.fileName}`));
  }

  if (toUpdate.length === 0) {
    console.log("\nNothing to update.");
    return;
  }

  console.log(`\n${toUpdate.length} mod(s) have updates available:`);
  toUpdate.forEach((mod) => {
    console.log(`  - ${mod.fileName} -> ${mod.latest.version_number}`);
  });

  if (args.dryRun) {
    console.log("\n--dry-run set: no files were downloaded or replaced.");
    return;
  }

  const backupDir = path.join(
    modsDir,
    ".mod-inspector-backups",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  await mkdir(backupDir, { recursive: true });

  console.log(`\nApplying updates (backups saved to ${backupDir})...`);
  let updatedCount = 0;
  for (const mod of toUpdate) {
    const file = pickPrimaryFile(mod.latest);
    if (!file) {
      console.error(`  ! ${mod.fileName}: no downloadable file found for the latest version, skipping.`);
      continue;
    }

    try {
      const buffer = await downloadAndVerify(file);
      await rename(path.join(modsDir, mod.fileName), path.join(backupDir, mod.fileName));
      await writeFile(path.join(modsDir, file.filename), buffer);
      console.log(`  ✓ ${mod.fileName} -> ${file.filename}`);
      updatedCount += 1;
    } catch (error) {
      console.error(`  ! ${mod.fileName}: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(`\nDone. ${updatedCount}/${toUpdate.length} mod(s) updated.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
