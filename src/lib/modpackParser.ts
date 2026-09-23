import JSZip from "jszip";
import type {
  CurseForgeManifest,
  ModrinthIndex,
  UnifiedModpack,
} from "@/types";

const loaderNames = ["fabric", "forge", "neoforge", "quilt"] as const;
type ModpackLoader = (typeof loaderNames)[number];

export async function parseModpackFile(
  fileBuffer: Buffer | ArrayBuffer,
): Promise<UnifiedModpack> {
  try {
    const archive = await JSZip.loadAsync(fileBuffer);
    const modrinthEntry = findArchiveEntry(archive, "modrinth.index.json");

    if (modrinthEntry) {
      const index = JSON.parse(await modrinthEntry.async("text")) as ModrinthIndex;
      return parseModpackManifest(index);
    }

    const curseForgeEntry = findArchiveEntry(archive, "manifest.json");
    if (curseForgeEntry) {
      const manifest = JSON.parse(
        await curseForgeEntry.async("text"),
      ) as CurseForgeManifest;
      return parseModpackManifest(manifest);
    }

    throw new Error(
      "O arquivo ZIP enviado não contém um manifesto válido do Modrinth ou CurseForge.",
    );
  } catch (zipError) {
    if (
      zipError instanceof Error &&
      zipError.message ===
        "O arquivo ZIP enviado não contém um manifesto válido do Modrinth ou CurseForge."
    ) {
      throw zipError;
    }

    try {
      const json = JSON.parse(decodeBuffer(fileBuffer)) as unknown;
      return parseModpackManifest(json);
    } catch {
      throw new Error(
        "Não foi possível ler o arquivo. Envie um modpack ZIP/MRPACK ou um manifesto JSON válido.",
        { cause: zipError },
      );
    }

    throw new Error(
      "Formato de modpack não reconhecido. Esperado CurseForge ou Modrinth.",
      { cause: zipError },
    );
  }
}

export function parseModpackManifest(value: unknown): UnifiedModpack {
  if (isModrinthIndex(value)) {
    return normalizeModrinth(value);
  }

  if (isCurseForgeManifest(value)) {
    return normalizeCurseForge(value);
  }

  throw new Error(
    "Manifesto inválido. Esperado manifest.json do CurseForge ou modrinth.index.json.",
  );
}

export function normalizeCurseForge(
  manifest: CurseForgeManifest,
): UnifiedModpack {
  const loaderEntry = manifest.minecraft.modLoaders.find(
    (loader) => loader.primary,
  ) ?? manifest.minecraft.modLoaders[0];

  if (!loaderEntry) {
    throw new Error("O manifesto CurseForge não define um mod loader.");
  }

  const { loader, version } = parseLoaderIdentifier(loaderEntry.id);

  return {
    format: "curseforge",
    name: manifest.name,
    gameVersion: manifest.minecraft.version,
    loader,
    loaderVersion: version,
    mods: manifest.files.map((file) => ({
      id: String(file.projectID),
      fileId: file.fileID,
    })),
  };
}

export function normalizeModrinth(index: ModrinthIndex): UnifiedModpack {
  const loaderEntry = findModrinthLoader(index.dependencies);

  if (!loaderEntry) {
    throw new Error("O índice Modrinth não define um mod loader suportado.");
  }

  const mods = index.files.map((file) => ({
    id: extractModrinthProjectId(file.downloads, file.path),
  }));

  return {
    format: "modrinth",
    name: index.name,
    gameVersion: index.dependencies.minecraft,
    loader: loaderEntry.loader,
    loaderVersion: loaderEntry.version,
    mods,
  };
}

function findArchiveEntry(
  archive: JSZip,
  fileName: string,
): JSZip.JSZipObject | undefined {
  return Object.values(archive.files).find(
    (entry) => entry.name === fileName || entry.name.endsWith(`/${fileName}`),
  );
}

function decodeBuffer(fileBuffer: Buffer | ArrayBuffer): string {
  const bytes = fileBuffer instanceof ArrayBuffer ? fileBuffer : new Uint8Array(fileBuffer);
  return new TextDecoder().decode(bytes);
}

function parseLoaderIdentifier(identifier: string): {
  loader: ModpackLoader;
  version: string;
} {
  const normalizedIdentifier = identifier.toLowerCase();
  const loader = loaderNames.find((name) =>
    normalizedIdentifier.startsWith(`${name}-`),
  );

  if (!loader) {
    throw new Error(`Mod loader CurseForge não suportado: ${identifier}`);
  }

  return {
    loader,
    version: identifier.slice(loader.length + 1),
  };
}

function findModrinthLoader(
  dependencies: ModrinthIndex["dependencies"],
): { loader: ModpackLoader; version: string } | undefined {
  const loaderDependencies: Array<{
    key: "fabric-loader" | "forge" | "neoforge" | "quilt-loader";
    loader: ModpackLoader;
  }> = [
    { key: "fabric-loader", loader: "fabric" },
    { key: "forge", loader: "forge" },
    { key: "neoforge", loader: "neoforge" },
    { key: "quilt-loader", loader: "quilt" },
  ];

  const found = loaderDependencies.find(({ key }) => dependencies[key]);
  return found
    ? { loader: found.loader, version: dependencies[found.key] as string }
    : undefined;
}

function extractModrinthProjectId(downloads: string[], path: string): string {
  for (const download of downloads) {
    const projectId = download.match(/(?:modrinth\.com\/data|\/data)\/([^/]+)/i)?.[1];
    if (projectId) {
      return projectId;
    }
  }

  const fileName = path.split("/").pop();
  const projectId = fileName?.replace(/\.jar$/i, "");
  if (projectId) {
    return projectId;
  }

  throw new Error(`Não foi possível identificar o projeto Modrinth para: ${path}`);
}

function isCurseForgeManifest(value: unknown): value is CurseForgeManifest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const manifest = value as Partial<CurseForgeManifest>;
  return (
    typeof manifest.name === "string" &&
    typeof manifest.version === "string" &&
    !!manifest.minecraft &&
    typeof manifest.minecraft.version === "string" &&
    Array.isArray(manifest.minecraft.modLoaders) &&
    Array.isArray(manifest.files)
  );
}

function isModrinthIndex(value: unknown): value is ModrinthIndex {
  if (!value || typeof value !== "object") {
    return false;
  }

  const index = value as Partial<ModrinthIndex>;
  return (
    typeof index.name === "string" &&
    typeof index.versionId === "string" &&
    !!index.dependencies &&
    typeof index.dependencies.minecraft === "string" &&
    Array.isArray(index.files)
  );
}
