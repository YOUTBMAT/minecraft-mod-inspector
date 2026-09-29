import JSZip from "jszip";
import type {
  ModAnalysisReport,
  PortCandidate,
  PortTargetFormat,
  UnifiedModpack,
} from "@/types";
interface ExportMod {
  id: string;
  version: string;
  fileId?: string | number;
  fileName?: string;
  downloadUrl?: string;
  fileSize?: number;
  sha1?: string;
  sha512?: string;
}

export async function exportUpdatedModpack(
  originalPack: UnifiedModpack,
  reports: Record<string, ModAnalysisReport>,
): Promise<void> {
  try {
    const mods = collectUpdatedMods(originalPack, reports);
    const manifest =
      originalPack.format === "modrinth"
        ? createModrinthManifest(originalPack, mods)
        : createCurseForgeManifest(originalPack, mods);
    const manifestName =
      originalPack.format === "modrinth"
        ? "modrinth.index.json"
        : "manifest.json";
    const filename =
      originalPack.format === "modrinth"
        ? "modpack-atualizado.mrpack"
        : "modpack-atualizado.zip";

    const archive = new JSZip();
    addManifestToArchive(archive, manifestName, manifest, originalPack.format);
    const blob = await archive.generateAsync({ type: "blob" });

    triggerDownload(blob, filename);
  } catch (error) {
    console.error("Falha ao exportar o modpack atualizado:", error);
    throw new Error("Não foi possível exportar o modpack atualizado.", {
      cause: error,
    });
  }
}

/**
 * Exports a modpack ported to a different platform than the one it was
 * uploaded in, using only mods the user explicitly confirmed a match for
 * (see PortReviewPanel) — never auto-applies a match.
 */
export async function exportPortedModpack(
  packMeta: {
    name: string;
    gameVersion: string;
    loader: UnifiedModpack["loader"];
    loaderVersion: string;
  },
  targetFormat: PortTargetFormat,
  confirmedCandidates: PortCandidate[],
): Promise<void> {
  try {
    const mods: ExportMod[] = confirmedCandidates.map((candidate) => ({
      id: candidate.targetId,
      version: targetFormat === "curseforge" ? candidate.fileId ?? "0" : candidate.targetId,
      fileId: candidate.fileId,
      fileName: candidate.fileName,
      downloadUrl: candidate.downloadUrl,
      fileSize: candidate.fileSize,
      sha1: candidate.sha1,
      sha512: candidate.sha512,
    }));

    const pseudoPack: UnifiedModpack = {
      format: targetFormat,
      name: packMeta.name,
      gameVersion: packMeta.gameVersion,
      loader: packMeta.loader,
      loaderVersion: packMeta.loaderVersion,
      mods: [],
    };

    const manifest =
      targetFormat === "modrinth"
        ? createModrinthManifest(pseudoPack, mods)
        : createCurseForgeManifest(pseudoPack, mods);
    const manifestName = targetFormat === "modrinth" ? "modrinth.index.json" : "manifest.json";
    const filename = targetFormat === "modrinth" ? "modpack-portado.mrpack" : "modpack-portado.zip";

    const archive = new JSZip();
    addManifestToArchive(archive, manifestName, manifest, targetFormat);
    const blob = await archive.generateAsync({ type: "blob" });

    triggerDownload(blob, filename);
  } catch (error) {
    console.error("Falha ao exportar o modpack portado:", error);
    throw new Error("Não foi possível exportar o modpack portado.", {
      cause: error,
    });
  }
}

function collectUpdatedMods(
  originalPack: UnifiedModpack,
  reports: Record<string, ModAnalysisReport>,
): ExportMod[] {
  const mods = originalPack.mods.map((mod) => {
    const report = reports[mod.id];
    const shouldUpdate =
      report?.status === "SAFE_UPDATE" ||
      report?.status === "CASCADING_REQUIRED";

      const fileId = shouldUpdate
        ? report?.latestFile?.fileId ?? mod.fileId
        : mod.fileId;

      return {
        id: mod.id,
        version: shouldUpdate ? report.latestVersion : String(fileId ?? "unknown"),
        fileId,
      fileName: report?.latestFile?.fileName,
      downloadUrl: report?.latestFile?.url,
      fileSize: report?.latestFile?.fileSize,
      sha1: report?.latestFile?.sha1,
      sha512: report?.latestFile?.sha512,
    };
  });

  const existingIds = new Set(mods.map((mod) => mod.id));
  for (const report of Object.values(reports)) {
    if (report.status !== "MISSING_DEPENDENCY") {
      continue;
    }

    for (const requiredModId of report.requiredNewMods) {
      if (!existingIds.has(requiredModId)) {
        mods.push({
          id: requiredModId,
          version: "unknown",
          fileId: undefined,
          fileName: undefined,
          downloadUrl: undefined,
          fileSize: undefined,
          sha1: undefined,
          sha512: undefined,
        });
        existingIds.add(requiredModId);
      }
    }
  }

  return mods;
}

function createModrinthManifest(
  originalPack: UnifiedModpack,
  mods: ExportMod[],
) {
  const loaderKey = {
    fabric: "fabric-loader",
    forge: "forge",
    neoforge: "neoforge",
    quilt: "quilt-loader",
  }[originalPack.loader];

  return {
    name: originalPack.name,
    versionId: `${originalPack.name}-updated`,
    dependencies: {
      minecraft: originalPack.gameVersion,
      [loaderKey]: originalPack.loaderVersion,
    },
    files: mods.map((mod) => ({
      path: `mods/${mod.fileName ?? `${mod.id}-${mod.version}.jar`}`,
      downloads: mod.downloadUrl ? [mod.downloadUrl] : [],
      // The Modrinth App's mrpack parser requires fileSize and hashes on
      // every entry, even ones with no known download (empty string/0
      // are schema-valid placeholders; such entries need manual install
      // anyway since they have no download source).
      fileSize: mod.fileSize ?? 0,
      hashes: {
        sha1: mod.sha1 ?? "",
        sha512: mod.sha512 ?? "",
      },
    })),
  };
}

function createCurseForgeManifest(
  originalPack: UnifiedModpack,
  mods: ExportMod[],
) {
  const files = mods.flatMap((mod) => {
    const projectID = toPositiveNumericId(mod.id);
    const fileID = toPositiveNumericId(mod.fileId);

    if (projectID === undefined || fileID === undefined) {
      return [];
    }

    return [{ projectID, fileID, required: true }];
  });

  return {
    manifestType: "minecraftModpack",
    manifestVersion: 1,
    name: originalPack.name,
    version: "1.0.0",
    author: "User",
    minecraft: {
      version: originalPack.gameVersion,
      modLoaders: [
        {
          id: `${originalPack.loader}-${normalizeLoaderVersion(
            originalPack.loader,
            originalPack.loaderVersion,
          )}`,
          primary: true,
        },
      ],
    },
    files,
    overrides: "overrides",
  };
}

function normalizeLoaderVersion(loader: UnifiedModpack["loader"], version: string): string {
  if (loader !== "neoforge") {
    return version;
  }

  const minimumVersion = "21.1.248";
  return compareLoaderVersions(version, minimumVersion) < 0
    ? minimumVersion
    : version;
}

function compareLoaderVersions(left: string, right: string): number {
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

function addManifestToArchive(
  archive: JSZip,
  manifestName: string,
  manifest: object,
  format: UnifiedModpack["format"],
): void {
  archive.file(
    normalizeZipPath(manifestName),
    serializeManifest(manifest),
  );

  if (format === "curseforge") {
    archive.folder(normalizeZipPath("overrides/"));
    archive.folder(normalizeZipPath("overrides/mods/"));
  }
}

function normalizeZipPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "");
}

function serializeManifest(manifest: object): string {
  const json = JSON.stringify(manifest, null, 2);
  JSON.parse(json);
  return json;
}

function toPositiveNumericId(
  value: string | number | undefined,
  fallback?: string | number,
): number | undefined {
  if (value !== undefined && value !== null) {
    const parsedValue = Number(value);
    if (Number.isSafeInteger(parsedValue) && parsedValue > 0) {
      return parsedValue;
    }
  }

  if (fallback !== undefined && fallback !== null) {
    const parsedFallback = Number(fallback);
    if (Number.isSafeInteger(parsedFallback) && parsedFallback > 0) {
      return parsedFallback;
    }
  }

  return undefined;
}

function triggerDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
