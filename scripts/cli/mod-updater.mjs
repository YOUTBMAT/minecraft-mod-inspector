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
import { readdir, readFile, writeFile, rename, mkdir, stat, rm } from "node:fs/promises";
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

/** fetch com retry em 429/5xx (respeita Retry-After) para não tratar rate limit como "sem versão". */
async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      if (attempt >= retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    if (response.status !== 429 && response.status < 500) {
      return response;
    }
    if (attempt >= retries) {
      return response;
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 10_000)
      : 1000 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
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
    const response = await fetchWithRetry(`${MODRINTH_API}/version_files`, {
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

  const response = await fetchWithRetry(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Modrinth version lookup failed for ${projectId}: HTTP ${response.status}`);
  }

  const versions = await response.json();
  if (!Array.isArray(versions) || versions.length === 0) {
    return null;
  }

  // Só sobe para beta/alpha se o projeto não tiver nenhum release: antes o
  // CLI trocava releases estáveis por alphas só por serem mais recentes.
  const byNewest = versions
    .slice()
    .sort((a, b) => new Date(b.date_published) - new Date(a.date_published));
  return byNewest.find((version) => version.version_type === "release") ?? byNewest[0];
}

function pickPrimaryFile(version) {
  return version.files?.find((file) => file.primary) ?? version.files?.[0] ?? null;
}

async function downloadAndVerify(file) {
  const response = await fetchWithRetry(file.url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Download failed (HTTP ${response.status}): ${file.url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  // Verificação obrigatória: antes, sem hash na resposta o arquivo era aceito sem checar nada.
  const expectedSha1 = file.hashes?.sha1;
  const expectedSha512 = file.hashes?.sha512;
  if (!expectedSha1 && !expectedSha512) {
    throw new Error(`No hash published for ${file.filename}; refusing to install unverified file.`);
  }
  if (expectedSha1) {
    const actualSha1 = createHash("sha1").update(buffer).digest("hex");
    if (actualSha1 !== expectedSha1) {
      throw new Error(
        `Downloaded file hash mismatch for ${file.filename}: expected ${expectedSha1}, got ${actualSha1}`,
      );
    }
  }
  if (expectedSha512) {
    const actualSha512 = createHash("sha512").update(buffer).digest("hex");
    if (actualSha512 !== expectedSha512) {
      throw new Error(`Downloaded file SHA-512 mismatch for ${file.filename}.`);
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

  const lookupFailed = [];
  for (const mod of identified) {
    let latest;
    try {
      latest = await fetchLatestVersion(mod.installedVersion.project_id, args.gameVersion, args.loader);
    } catch (error) {
      // Falha de rede/rate limit não é "sem versão compatível": reporta à parte.
      lookupFailed.push({ mod, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (!latest) {
      noCompatibleVersion.push(mod);
      continue;
    }
    const installedDate = new Date(mod.installedVersion.date_published);
    const latestDate = new Date(latest.date_published);
    // Mesma versão, ou a instalada já é mais nova (ex.: beta) que o último release: não mexer.
    if (latest.id === mod.installedVersion.id || installedDate >= latestDate) {
      upToDate.push(mod);
      continue;
    }
    toUpdate.push({ ...mod, latest });
  }

  console.log(`\n${upToDate.length} mod(s) already up to date.`);
  if (lookupFailed.length > 0) {
    console.log(`${lookupFailed.length} mod(s) could not be checked (network/rate limit) — run again later:`);
    lookupFailed.forEach(({ mod, reason }) => console.log(`  - ${mod.fileName}: ${reason}`));
  }
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

    // O nome vem da API: nunca confiar em separadores de caminho.
    const safeName = path.basename(file.filename);
    const targetPath = path.join(modsDir, safeName);
    const tempPath = `${targetPath}.mod-inspector-tmp`;
    let originalMoved = false;

    try {
      if (safeName !== mod.fileName && jarHashes.has(safeName)) {
        throw new Error(`${safeName} already exists in the mods folder; skipping to avoid overwriting it.`);
      }
      const buffer = await downloadAndVerify(file);
      // 1) grava o novo em arquivo temporário (se falhar aqui, nada mudou);
      await writeFile(tempPath, buffer);
      // 2) move o original para o backup;
      await rename(path.join(modsDir, mod.fileName), path.join(backupDir, mod.fileName));
      originalMoved = true;
      // 3) publica o novo com rename atômico.
      await rename(tempPath, targetPath);
      console.log(`  ✓ ${mod.fileName} -> ${safeName}`);
      updatedCount += 1;
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => {});
      if (originalMoved) {
        // Rollback: devolve o original para que o mod não desapareça da pasta.
        await rename(path.join(backupDir, mod.fileName), path.join(modsDir, mod.fileName)).catch(() => {});
      }
      console.error(`  ! ${mod.fileName}: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(`\nDone. ${updatedCount}/${toUpdate.length} mod(s) updated.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
