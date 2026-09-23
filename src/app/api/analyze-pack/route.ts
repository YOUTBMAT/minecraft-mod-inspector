import { NextResponse } from "next/server";
import type { InstalledMod } from "@/types";
import { analyzeModpack } from "@/lib/dependencyResolver";
import { parseModpackManifest } from "@/lib/modpackParser";
import {
  resolveCurseForgeMods,
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
    const curseForgeMods = packInfo.format === "curseforge"
      ? await resolveCurseForgeMods(packInfo.mods, gameVersion, loader)
      : undefined;
    const modrinthMeta = packInfo.format === "modrinth"
      ? await resolveModrinthProjectMeta(packInfo.mods.map((mod) => mod.id))
      : undefined;
    const enrichedPackInfo = {
      ...packInfo,
      ...(recommendedLoaderVersion
        ? { loaderVersion: recommendedLoaderVersion }
        : {}),
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
    for (const [id, mod] of allModrinthMeta ?? []) {
      modNames.set(id, mod.title);
    }

    return NextResponse.json(
      {
        packInfo: enrichedPackInfo,
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
