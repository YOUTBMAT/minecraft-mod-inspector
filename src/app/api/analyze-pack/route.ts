import { NextResponse } from "next/server";
import type { InstalledMod } from "@/types";
import { analyzeModpack } from "@/lib/dependencyResolver";
import { parseModpackFile } from "@/lib/modpackParser";
import { resolveCurseForgeMods } from "@/lib/curseforgeService";
import { resolveModrinthProjectMeta } from "@/lib/modrinthService";
import { detectKnownConflicts } from "@/lib/modConflicts";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const fileEntry = formData.get("file");

    if (!fileEntry || typeof fileEntry === "string") {
      return NextResponse.json(
        { error: "O campo 'file' é obrigatório e deve conter um arquivo." },
        { status: 400 },
      );
    }

    const packInfo = await parseModpackFile(await fileEntry.arrayBuffer());
    const gameVersion = getFormValue(formData, "gameVersion") ?? packInfo.gameVersion;
    const loader = getFormValue(formData, "loader") ?? packInfo.loader;
    const curseForgeMods = packInfo.format === "curseforge"
      ? await resolveCurseForgeMods(packInfo.mods, gameVersion, loader)
      : undefined;
    const modrinthMeta = packInfo.format === "modrinth"
      ? await resolveModrinthProjectMeta(packInfo.mods.map((mod) => mod.id))
      : undefined;
    const enrichedPackInfo = {
      ...packInfo,
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
    );

    return NextResponse.json(
      {
        packInfo: enrichedPackInfo,
        reports: Object.fromEntries(reports),
        conflicts,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Falha ao analisar o modpack.",
      },
      { status: 500 },
    );
  }
}

function getFormValue(formData: FormData, fieldName: string): string | undefined {
  const value = formData.get(fieldName);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
