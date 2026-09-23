const CURSEFORGE_API_URL = "https://api.curseforge.com/v1/mods";
const CURSEFORGE_SEARCH_URL = "https://api.curseforge.com/v1/mods/search";
const CURSEFORGE_MODLOADER_URL = "https://api.curseforge.com/v1/minecraft/modloader";
const CURSEFORGE_MINECRAFT_GAME_ID = 432;
const CURSEFORGE_MOD_CLASS_ID = 6;
const CURSEFORGE_BATCH_SIZE = 50;
export const FABRIC_BRIDGE_PROJECT_IDS = ["883520", "882495"] as const;
export const FABRIC_BRIDGE_PROJECT_SLUGS = {
  "sinytra-connector": "Sinytra Connector",
  "forgified-fabric-api": "Forgified Fabric API",
} as const;
const CURSEFORGE_LOADER_TYPES: Record<string, number> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6,
};

interface CurseForgeFile {
  id: number;
  displayName?: string;
  fileName?: string;
  fileDate?: string;
  gameVersions?: string[];
  modLoader?: number;
  releaseType?: number;
  downloadUrl?: string | null;
  dependencies?: CurseForgeFileDependency[];
}

interface CurseForgeFileDependency {
  modId: number;
  fileId?: number;
  relationType: number;
}

interface CurseForgeFileIndex {
  gameVersion: string;
  fileId: number;
  filename?: string;
  modLoader?: number;
}

interface CurseForgeApiMod {
  id: number;
  name?: string;
  latestFiles?: CurseForgeFile[];
  latestFilesIndexes?: CurseForgeFileIndex[];
  slug?: string;
  categories?: Array<{ name?: string }>;
}

interface CurseForgeApiResponse {
  data?: CurseForgeApiMod[];
}

interface CurseForgeModLoader {
  name?: string;
  gameVersion?: string;
  latest?: string;
  recommended?: string;
}

interface CurseForgeModLoaderResponse {
  data?: CurseForgeModLoader[];
}

interface CurseForgeFileResponse {
  data?: CurseForgeFile[];
}

export interface CurseForgeResolvedMod {
  projectId: string;
  fileId: string;
  displayName: string;
  installedVersion: string;
  latestVersion: string;
  latestFileId: string;
  latestFileName?: string;
  latestDownloadUrl?: string;
  updateAvailable: boolean;
  loaderCompatible: boolean;
  requiresFabricBridge: boolean;
  supportsFabric: boolean;
  supportsForge: boolean;
  requiredDependencies: Array<{
    projectId: string;
    fileId?: string;
  }>;
}

const resolvedModsCache = new Map<string, Promise<Map<string, CurseForgeResolvedMod>>>();
const modLoaderVersionCache = new Map<string, Promise<string | undefined>>();

export function resolveRecommendedModLoaderVersion(
  gameVersion: string,
  loader: string,
): Promise<string | undefined> {
  const cacheKey = `${gameVersion}|${loader.toLowerCase()}`;
  const cached = modLoaderVersionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const request = fetchRecommendedModLoaderVersion(gameVersion, loader);
  modLoaderVersionCache.set(cacheKey, request);
  return request;
}

export function resolveCurseForgeMods(
  mods: Array<{ id: string; fileId?: string | number }>,
  gameVersion: string,
  loader: string,
): Promise<Map<string, CurseForgeResolvedMod>> {
  const cacheKey = JSON.stringify([
    mods.map((mod) => [mod.id, mod.fileId]),
    gameVersion,
    loader.toLowerCase(),
  ]);
  const cached = resolvedModsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const request = fetchResolvedMods(mods, gameVersion, loader);
  resolvedModsCache.set(cacheKey, request);
  return request;
}

export async function resolveCurseForgeModsBySlug(
  slugs: string[],
  gameVersion: string,
  loader: string,
): Promise<Map<string, CurseForgeResolvedMod>> {
  const apiKey = process.env.CURSEFORGE_API_KEY;
  if (!apiKey || slugs.length === 0) {
    return new Map();
  }

  const projects = await Promise.all(
    slugs.map((slug) => fetchProjectBySlug(slug, apiKey)),
  );
  const resolved = await resolveCurseForgeMods(
    projects
      .filter((project): project is CurseForgeApiMod => project !== undefined)
      .map((project) => ({ id: String(project.id) })),
    gameVersion,
    loader,
  );

  return new Map(
    projects.flatMap((project) => {
      if (!project) {
        return [];
      }

      const resolvedMod = resolved.get(String(project.id));
      if (!resolvedMod) {
        return [];
      }

      const forcedName = FABRIC_BRIDGE_PROJECT_SLUGS[
        project.slug as keyof typeof FABRIC_BRIDGE_PROJECT_SLUGS
      ];
      return [[String(project.id), {
        ...resolvedMod,
        displayName: forcedName ?? resolvedMod.displayName,
      }] as const];
    }),
  );
}

async function fetchResolvedMods(
  mods: Array<{ id: string; fileId?: string | number }>,
  gameVersion: string,
  loader: string,
): Promise<Map<string, CurseForgeResolvedMod>> {
  const fallback = new Map(
    mods.map((mod) => [
      mod.id,
      createFallbackMod(mod.id, String(mod.fileId ?? "unknown")),
    ]),
  );
  const apiKey = process.env.CURSEFORGE_API_KEY;

  if (!apiKey) {
    console.log(
      "[CurseForge] CURSEFORGE_API_KEY não está definida; a análise usará dados de fallback.",
    );
    return fallback;
  }

  const resolved = new Map<string, CurseForgeResolvedMod>();
  const pending = [...mods];
  const queuedIds = new Set(mods.map((mod) => mod.id));

  for (let index = 0; index < pending.length; index += CURSEFORGE_BATCH_SIZE) {
    const batch = pending.slice(index, index + CURSEFORGE_BATCH_SIZE);
    const apiMods = await fetchBatch(
      batch.map((mod) => Number(mod.id)).filter(Number.isSafeInteger),
      apiKey,
    );
    const apiFiles = await fetchFileBatch(
      batch.map((mod) => Number(mod.fileId)).filter(Number.isSafeInteger),
      apiKey,
      loader,
    );
    const latestFileIds = batch
      .map((mod) => apiMods.get(Number(mod.id)))
      .map((mod) => mod && pickCompatibleFile(mod, gameVersion, loader)?.fileId)
      .filter((fileId): fileId is string => fileId !== undefined)
      .map(Number)
      .filter(Number.isSafeInteger)
      .filter((fileId) => !apiFiles.has(fileId));
    const latestFiles = await fetchFileBatch(latestFileIds, apiKey, loader);
    for (const [fileId, file] of latestFiles) {
      apiFiles.set(fileId, file);
    }

    for (const mod of batch) {
      const apiMod = apiMods.get(Number(mod.id));
      const fileId = String(mod.fileId ?? "unknown");
      resolved.set(
        mod.id,
        apiMod
          ? formatResolvedMod(
              apiMod,
              fileId,
              apiFiles,
              gameVersion,
              loader,
            )
          : createFallbackMod(mod.id, fileId),
      );

      for (const dependency of resolved.get(mod.id)?.requiredDependencies ?? []) {
        if (!queuedIds.has(dependency.projectId)) {
          queuedIds.add(dependency.projectId);
          pending.push({ id: dependency.projectId, fileId: dependency.fileId });
        }
      }
    }
  }

  return resolved;
}

async function fetchBatch(
  modIds: number[],
  apiKey: string,
): Promise<Map<number, CurseForgeApiMod>> {
  if (modIds.length === 0) {
    return new Map();
  }

  try {
    const response = await fetch(CURSEFORGE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        modIds,
      }),
    });

    if (!response.ok) {
      console.log(
        `[CurseForge] POST /v1/mods falhou com HTTP ${response.status}.`,
      );
      return new Map();
    }

    const body = (await response.json()) as CurseForgeApiResponse;
    return new Map((body.data ?? []).map((mod) => [mod.id, mod]));
  } catch (error) {
    console.log(
      "[CurseForge] Falha ao consultar POST /v1/mods:",
      error instanceof Error ? error.message : error,
    );
    return new Map();
  }
}

async function fetchFileBatch(
  fileIds: number[],
  apiKey: string,
  loader: string,
): Promise<Map<number, CurseForgeFile>> {
  if (fileIds.length === 0) {
    return new Map();
  }

  try {
    const response = await fetch(`${CURSEFORGE_API_URL}/files`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        fileIds,
        modLoaderType: getCurseForgeLoaderType(loader),
      }),
    });

    if (!response.ok) {
      console.log(
        `[CurseForge] POST /v1/mods/files falhou com HTTP ${response.status}.`,
      );
      return new Map();
    }

    const body = (await response.json()) as CurseForgeFileResponse;
    return new Map((body.data ?? []).map((file) => [file.id, file]));
  } catch (error) {
    console.log(
      "[CurseForge] Falha ao consultar POST /v1/mods/files:",
      error instanceof Error ? error.message : error,
    );
    return new Map();
  }
}

function pickCompatibleFile(
  mod: CurseForgeApiMod,
  gameVersion: string,
  loader: string,
): { fileId: string; fileName: string; downloadUrl?: string } | undefined {
  const indexedCandidates = (mod.latestFilesIndexes ?? [])
    .filter((file) => file.gameVersion === gameVersion)
    .filter((file) => isCompatibleLoader(file.modLoader, loader))
    .map((file) => ({
      index: file,
      details: mod.latestFiles?.find((candidate) => candidate.id === file.fileId),
    }));
  const fileCandidates = [
    ...indexedCandidates
      .filter((candidate) => candidate.details)
      .map((candidate) => candidate.details as CurseForgeFile),
    ...(mod.latestFiles ?? []),
  ]
    .filter((file) => isCompatibleFile(file, gameVersion, loader));
  const uniqueCandidates = Array.from(
    new Map(fileCandidates.map((file) => [file.id, file])).values(),
  );
  const stableCandidates = uniqueCandidates.filter((file) => file.releaseType === 1);
  const candidates = stableCandidates.length > 0 ? stableCandidates : uniqueCandidates;
  const latestFile = candidates.sort(compareCurseForgeFiles)[0];

  if (!latestFile) {
    return undefined;
  }

  const fileId = String(latestFile.id);
  return {
    fileId,
    fileName: formatFile(latestFile, fileId),
    downloadUrl: latestFile?.downloadUrl ?? undefined,
  };
}

function formatResolvedMod(
  mod: CurseForgeApiMod,
  installedFileId: string,
  fileDetails: Map<number, CurseForgeFile>,
  gameVersion: string,
  loader: string,
): CurseForgeResolvedMod {
  const installedFile = fileDetails.get(Number(installedFileId));
  const knownInstalledFile = installedFile ?? mod.latestFiles?.find(
    (file) => String(file.id) === installedFileId,
  );
  const compatible = pickCompatibleFile(mod, gameVersion, loader);
  const latestFileId = compatible?.fileId ?? installedFileId;
  const installedVersion = formatFile(knownInstalledFile, installedFileId);
  const latestVersion = compatible?.fileName ?? installedVersion;
  const supportsFabric = hasProjectLoaderSupport(mod, "fabric") ||
    hasFileLoaderSupport(knownInstalledFile, "fabric");
  const supportsForge = hasProjectLoaderSupport(mod, "forge") ||
    hasFileLoaderSupport(knownInstalledFile, "forge") ||
    hasFileLoaderSupport(knownInstalledFile, "neoforge");
  const loaderCompatible = knownInstalledFile === undefined
    ? supportsLoaderSupport(mod, loader)
    : isCompatibleFile(knownInstalledFile, gameVersion, loader);
  const dependencyFile = compatible?.fileId
    ? fileDetails.get(Number(compatible.fileId)) ?? mod.latestFiles?.find(
        (file) => String(file.id) === compatible.fileId,
      )
    : knownInstalledFile;
  const requiredDependencies = (dependencyFile?.dependencies ?? [])
    .filter((dependency) => dependency.relationType === 3)
    .map((dependency) => ({
      projectId: String(dependency.modId),
      fileId: dependency.fileId !== undefined &&
        (fileDetails.has(dependency.fileId) || mod.latestFiles?.some(
          (file) => file.id === dependency.fileId,
        )) &&
        isCompatibleDependencyFile(
          fileDetails.get(dependency.fileId) ?? mod.latestFiles?.find(
            (file) => file.id === dependency.fileId,
          ),
          gameVersion,
          loader,
        )
        ? String(dependency.fileId)
        : undefined,
    }));

  return {
    projectId: String(mod.id),
    fileId: installedFileId,
    displayName: mod.name ?? `Mod ${mod.id}`,
    installedVersion,
    latestVersion,
    latestFileId,
    latestFileName: compatible?.fileName,
    latestDownloadUrl: compatible?.downloadUrl,
    updateAvailable: latestFileId !== installedFileId,
    loaderCompatible,
    supportsFabric,
    supportsForge,
    requiresFabricBridge: (supportsFabric && !supportsForge) || requiredDependencies.some(
      (dependency) => FABRIC_BRIDGE_PROJECT_IDS.includes(
        dependency.projectId as (typeof FABRIC_BRIDGE_PROJECT_IDS)[number],
      ),
    ),
    requiredDependencies,
  };
}

async function fetchRecommendedModLoaderVersion(
  gameVersion: string,
  loader: string,
): Promise<string | undefined> {
  const apiKey = process.env.CURSEFORGE_API_KEY;
  if (!apiKey || loader.toLowerCase() !== "neoforge") {
    return undefined;
  }

  try {
    const url = new URL(CURSEFORGE_MODLOADER_URL);
    url.searchParams.set("gameVersion", gameVersion);
    const response = await fetch(url, { headers: { "x-api-key": apiKey } });
    if (!response.ok) {
      return undefined;
    }

    const body = (await response.json()) as CurseForgeModLoaderResponse;
    const match = (body.data ?? []).find(
      (entry) => entry.gameVersion === gameVersion &&
        entry.name?.toLowerCase().includes("neoforge"),
    );
    return match?.recommended ?? match?.latest;
  } catch {
    return undefined;
  }
}

async function fetchProjectBySlug(
  slug: string,
  apiKey: string,
): Promise<CurseForgeApiMod | undefined> {
  try {
    const url = new URL(CURSEFORGE_SEARCH_URL);
    url.searchParams.set("gameId", String(CURSEFORGE_MINECRAFT_GAME_ID));
    url.searchParams.set("classId", String(CURSEFORGE_MOD_CLASS_ID));
    url.searchParams.set("searchFilter", slug);
    url.searchParams.set("pageSize", "10");
    const response = await fetch(url, { headers: { "x-api-key": apiKey } });
    if (!response.ok) {
      return undefined;
    }

    const body = (await response.json()) as CurseForgeApiResponse;
    return (body.data ?? []).find(
      (project) => project.slug?.toLowerCase() === slug.toLowerCase(),
    );
  } catch {
    return undefined;
  }
}

function compareCurseForgeFiles(left: CurseForgeFile, right: CurseForgeFile): number {
  return (right.fileDate ?? "").localeCompare(left.fileDate ?? "") || right.id - left.id;
}

function isCompatibleDependencyFile(
  file: CurseForgeFile | undefined,
  gameVersion: string,
  loader: string,
): boolean {
  return file !== undefined && isCompatibleFile(file, gameVersion, loader);
}

export interface CurseForgeSearchCandidate {
  id: string;
  name: string;
  fileId?: string;
  fileName?: string;
}

/**
 * Searches CurseForge's public mod index by name. Used for best-effort
 * cross-platform matching (e.g. finding a Modrinth mod's CurseForge
 * counterpart) — there is no official ID crosswalk between the two
 * platforms, so this is a heuristic, not a guaranteed match.
 */
export async function searchCurseForgeMods(
  query: string,
  gameVersion: string,
  loader: string,
  apiKey: string,
): Promise<CurseForgeSearchCandidate[]> {
  try {
    const url = new URL(CURSEFORGE_SEARCH_URL);
    url.searchParams.set("gameId", String(CURSEFORGE_MINECRAFT_GAME_ID));
    url.searchParams.set("classId", String(CURSEFORGE_MOD_CLASS_ID));
    url.searchParams.set("searchFilter", query);
    url.searchParams.set("pageSize", "5");
    url.searchParams.set(
      "modLoaderType",
      String(getCurseForgeLoaderType(loader)),
    );

    const response = await fetch(url, {
      headers: { "x-api-key": apiKey },
    });

    if (!response.ok) {
      return [];
    }

    const body = (await response.json()) as CurseForgeApiResponse;
    return (body.data ?? []).map((mod) => {
      const compatible = pickCompatibleFile(mod, gameVersion, loader);
      return {
        id: String(mod.id),
        name: mod.name ?? `Mod ${mod.id}`,
        fileId: compatible?.fileId,
        fileName: compatible?.fileName,
      };
    });
  } catch {
    return [];
  }
}

function createFallbackMod(projectId: string, fileId: string): CurseForgeResolvedMod {
  return {
    projectId,
    fileId,
    displayName: `Mod ${projectId}`,
    installedVersion: `Arquivo ${fileId}`,
    latestVersion: `Arquivo ${fileId}`,
    latestFileId: fileId,
    updateAvailable: false,
    loaderCompatible: true,
    requiresFabricBridge: false,
    supportsFabric: false,
    supportsForge: true,
    requiredDependencies: [],
  };
}

function formatFile(file: CurseForgeFile | undefined, fallbackId: string): string {
  return file?.displayName ?? file?.fileName ?? `Arquivo ${fallbackId}`;
}

function isCompatibleLoader(modLoader: number | undefined, loader: string): boolean {
  if (modLoader === undefined) {
    return true;
  }

  if (loader.toLowerCase() === "neoforge") {
    return modLoader === CURSEFORGE_LOADER_TYPES.neoforge ||
      modLoader === CURSEFORGE_LOADER_TYPES.forge;
  }

  return modLoader === getCurseForgeLoaderType(loader);
}

function isCompatibleFile(
  file: CurseForgeFile,
  gameVersion: string,
  loader: string,
): boolean {
  const gameVersions = file.gameVersions ?? [];
  const normalizedLoader = loader.toLowerCase();
  const hasGameVersion = gameVersions.includes(gameVersion);
  const loaderTags = gameVersions.map((version) => version.toLowerCase());
  const hasNeoForgeTag = loaderTags.includes("neoforge") || loaderTags.includes("forge");

  return hasGameVersion &&
    isCompatibleLoader(file.modLoader, loader) &&
    (normalizedLoader !== "neoforge" || hasNeoForgeTag || file.modLoader === CURSEFORGE_LOADER_TYPES.forge);
}

function hasProjectLoaderSupport(mod: CurseForgeApiMod, loader: string): boolean {
  return (mod.categories ?? []).some((category) =>
    category.name?.toLowerCase().includes(loader.toLowerCase()),
  );
}

function hasFileLoaderSupport(file: CurseForgeFile | undefined, loader: string): boolean {
  return file?.gameVersions?.some(
    (version) => version.toLowerCase() === loader.toLowerCase(),
  ) ?? false;
}

function supportsLoaderSupport(mod: CurseForgeApiMod, loader: string): boolean {
  return hasProjectLoaderSupport(mod, loader) ||
    (loader.toLowerCase() === "neoforge" && hasProjectLoaderSupport(mod, "forge"));
}

function getCurseForgeLoaderType(loader: string): number | undefined {
  return CURSEFORGE_LOADER_TYPES[loader.toLowerCase()];
}