import { NextResponse } from "next/server";
import type { InstalledMod } from "@/types";
import { analyzeModpack } from "@/lib/dependencyResolver";
import { parseModpackManifest } from "@/lib/modpackParser";
import {
  FABRIC_BRIDGE_PROJECT_IDS,
  FABRIC_BRIDGE_PROJECT_SLUGS,
  resolveCurseForgeMods,
  resolveCurseForgeModsBySlug,
  resolveCurseForgeProjectNames,
  resolveRecommendedModLoaderVersion,
} from "@/lib/curseforgeService";
import { resolveModrinthProjectMeta } from "@/lib/modrinthService";
import { detectKnownConflicts } from "@/lib/modConflicts";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return NextResponse.json(
        { error: "Envie apenas o JSON do manifesto em application/json." },
        { status: 415 },
      );
    }

    const manifest = (await request.json()) as unknown;
    const packInfo = parseModpackManifest(manifest);
    const gameVersion = packInfo.gameVersion;
    const loader = packInfo.loader;
    const recommendedLoaderVersion = await resolveRecommendedModLoaderVersion(
      gameVersion,
      loader,
    );
    const loaderVersion = loader === "neoforge"
      ? maxVersion(packInfo.loaderVersion, recommendedLoaderVersion, "21.1.248")
      : packInfo.loaderVersion;
    const curseForgeMods = packInfo.format === "curseforge"
      ? await resolveCurseForgeMods(packInfo.mods, gameVersion, loader)
      : undefined;
    const modrinthMeta = packInfo.format === "modrinth"
      ? await resolveModrinthProjectMeta(packInfo.mods.map((mod) => mod.id))
      : undefined;
    const enrichedPackInfo = {
      ...packInfo,
      loaderVersion,
      mods: packInfo.mods.map((mod) => ({
        ...mod,
        ...(curseForgeMods
          ? {
              name: curseForgeMods.get(mod.id)?.displayName,
              version: curseForgeMods.get(mod.id)?.installedVersion,
            }
          : {}),
        ...(modrinthMeta
          ? { name: modrinthMeta.get(mod.id)?.title }
          : {}),
      })),
    };
    const installedMods: InstalledMod[] = packInfo.mods.map((mod) => ({
      id: mod.id,
      currentVersion: curseForgeMods?.get(mod.id)?.installedVersion
        ?? (mod.fileId === undefined ? "unknown" : String(mod.fileId)),
      name: curseForgeMods?.get(mod.id)?.displayName ?? modrinthMeta?.get(mod.id)?.title,
    }));

    const reports = await analyzeModpack(
      installedMods,
      gameVersion,
      loader,
      packInfo.format,
      curseForgeMods,
    );

    const packHasContinuity = packInfo.mods.some((mod) =>
      isContinuityMod(mod.name ?? "", mod.id),
    );
    const requiresFabricBridge = loader === "neoforge" &&
      (packHasContinuity || Array.from(curseForgeMods?.values() ?? []).some(
        (mod) => isContinuityMod(mod.displayName, mod.projectId) ||
          mod.requiresFabricBridge || mod.requiredDependencies.some(
          (dependency) => FABRIC_BRIDGE_PROJECT_IDS.includes(
            dependency.projectId as (typeof FABRIC_BRIDGE_PROJECT_IDS)[number],
          ),
          ),
        ));
    const fabricBridgeMods = requiresFabricBridge
      ? await resolveCurseForgeModsBySlug(
          Object.keys(FABRIC_BRIDGE_PROJECT_SLUGS),
          gameVersion,
          loader,
        )
      : undefined;
    const exportPackInfo = {
      ...enrichedPackInfo,
      mods: [
        ...enrichedPackInfo.mods,
        ...(curseForgeMods
          ? Array.from(curseForgeMods.values()).flatMap((resolvedMod) => {
              if (packInfo.mods.some((mod) => mod.id === resolvedMod.projectId)) {
                return [];
              }

              return [{
                id: resolvedMod.projectId,
                fileId: resolvedMod.latestFileId,
                name: resolvedMod.displayName,
                version: resolvedMod.latestVersion,
              }];
            })
          : []),
        ...(fabricBridgeMods
          ? Array.from(fabricBridgeMods.values()).flatMap((bridgeMod) => {
              if (!isPositiveNumericId(bridgeMod.latestFileId)) {
                console.warn(
                  `[analyze-pack] Connector sem fileID válido; projeto ${bridgeMod.projectId} não será exportado.`,
                );
                return [];
              }

              return [{
                id: bridgeMod.projectId,
                fileId: Number(bridgeMod.latestFileId),
                name: bridgeMod.displayName,
                version: bridgeMod.latestVersion,
              }];
            })
          : []),
      ].filter(
        (mod, index, mods) => mods.findIndex((candidate) => candidate.id === mod.id) === index,
      ),
    };

    const conflicts = detectKnownConflicts(
      installedMods.map((mod) => ({
        id: mod.id,
        name: mod.name,
        slug: modrinthMeta?.get(mod.id)?.slug,
      })),
      packInfo.loader,
    );
    const reportModIds = Array.from(reports.values()).flatMap((report) => [
      ...report.requiredNewMods,
      ...report.cascadingUpdates,
      ...report.conflictingMods,
    ]);
    const missingCurseForgeNames = packInfo.format === "curseforge"
      ? await resolveCurseForgeProjectNames(reportModIds)
      : new Map<string, string>();
    const allModrinthMeta = packInfo.format === "modrinth"
      ? await resolveModrinthProjectMeta([
          ...packInfo.mods.map((mod) => mod.id),
          ...reportModIds,
        ])
      : modrinthMeta;
    const modNames = new Map<string, string>();
    for (const mod of packInfo.mods) {
      if (mod.name) {
        modNames.set(mod.id, mod.name);
      }
    }
    for (const [id, mod] of curseForgeMods ?? []) {
      modNames.set(id, mod.displayName);
    }
    for (const [id, mod] of fabricBridgeMods ?? []) {
      modNames.set(id, mod.displayName);
    }
    for (const [id, mod] of allModrinthMeta ?? []) {
      modNames.set(id, mod.title);
    }
    for (const [id, name] of missingCurseForgeNames) {
      if (!modNames.has(id) || /^\d+$/.test(modNames.get(id) ?? "")) {
        modNames.set(id, name);
      }
    }
    const namedPackInfo = {
      ...exportPackInfo,
      mods: exportPackInfo.mods.map((mod) => {
        const resolvedName = modNames.get(mod.id);
        return resolvedName &&
          (/^\d+$/.test(mod.name?.trim() ?? "") || !mod.name)
          ? { ...mod, name: resolvedName }
          : mod;
      }),
    };

    return NextResponse.json(
      {
        packInfo: namedPackInfo,
        reports: Object.fromEntries(reports),
        conflicts,
        modNames: Object.fromEntries(modNames),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[analyze-pack] Falha ao analisar manifesto", {
      contentType: request.headers.get("content-type"),
      error,
    });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Falha ao analisar o modpack.",
      },
      { status: 500 },
    );
  }
}

function maxVersion(...versions: Array<string | undefined>): string {
  return versions.filter((version): version is string => version !== undefined)
    .reduce((current, candidate) => compareVersions(candidate, current) > 0 ? candidate : current);
}

function isContinuityMod(displayName: string, projectId: string): boolean {
  return projectId.toLowerCase() === "continuity" ||
    displayName.toLowerCase().replace(/[\s:_-]+/g, "").includes("continuity");
}

function isPositiveNumericId(value: string | number | undefined): boolean {
  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) && numericValue > 0;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.match(/\d+/g)?.map(Number) ?? [];
  const rightParts = right.match(/\d+/g)?.map(Number) ?? [];
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}
