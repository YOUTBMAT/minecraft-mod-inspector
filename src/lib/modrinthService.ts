import type { LatestFileInfo, ModrinthDependency } from "@/types";
import { extractVersionFromFileName } from "@/lib/modpack/version-comparator";

interface ModrinthVersionFile {
  url: string;
  filename: string;
  primary: boolean;
  size: number;
  hashes?: {
    sha1?: string;
    sha512?: string;
  };
}

interface ModrinthVersionResponse {
  id: string;
  project_id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  dependencies: ModrinthDependency[];
  date_published: string;
  version_type?: "release" | "beta" | "alpha";
  files: ModrinthVersionFile[];
}

interface UpdateCheckResult {
  latestVersionId: string;
  latestVersionNumber: string;
  releaseDate: string;
  dependencies: {
    required: ModrinthDependency[];
    optional: ModrinthDependency[];
    incompatible: ModrinthDependency[];
  };
  latestFile?: LatestFileInfo;
}

const MODRINTH_API_URL = "https://api.modrinth.com/v2/project";
const MODRINTH_USER_AGENT =
  "MinecraftModInspector/1.0.0 (suporte@modinspector.local)";
const updateCheckCache = new Map<
  string,
  Promise<UpdateCheckResult | null>
>();

// A Modrinth limita ~300 req/min por IP. Sem controle de concorrência, um pack
// grande dispara centenas de requests ao mesmo tempo e as respostas 429 eram
// tratadas como "sem atualização".
const MAX_CONCURRENT_REQUESTS = 6;
const MAX_RATE_LIMIT_RETRIES = 3;
let activeRequests = 0;
const waitingForSlot: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests += 1;
    return;
  }
  await new Promise<void>((resolve) => waitingForSlot.push(resolve));
}

function releaseSlot(): void {
  const next = waitingForSlot.shift();
  if (next) {
    next(); // repassa o slot direto, sem abrir janela para outra chamada furar a fila
  } else {
    activeRequests -= 1;
  }
}

/**
 * fetch com limite de concorrência e retry em 429 (respeita Retry-After).
 * Lança erro em falha de rede ou se o rate limit persistir.
 */
async function modrinthFetch(url: URL, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    await acquireSlot();
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: { "User-Agent": MODRINTH_USER_AGENT, ...init?.headers },
      });
    } finally {
      releaseSlot();
    }

    if (response.status !== 429) {
      return response;
    }
    if (attempt >= MAX_RATE_LIMIT_RETRIES) {
      throw new Error("Modrinth rate limit excedido.");
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 10_000)
      : 1000 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export async function checkModrinthUpdate(
  projectIdOrSlug: string,
  gameVersion: string,
  loader: string,
): Promise<UpdateCheckResult | null> {
  const cacheKey = [projectIdOrSlug, gameVersion, loader.toLowerCase()].join("|");
  const cachedResult = updateCheckCache.get(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  const request = fetchModrinthUpdate(projectIdOrSlug, gameVersion, loader)
    .catch((error: unknown) => {
      // Falha transitória (rede/429): não guardar no cache, senão o erro fica
      // "colado" até o processo reiniciar.
      updateCheckCache.delete(cacheKey);
      console.warn(`[Modrinth] Falha ao consultar ${projectIdOrSlug}:`, error);
      return null;
    });
  updateCheckCache.set(cacheKey, request);
  return request;
}

async function fetchModrinthUpdate(
  projectIdOrSlug: string,
  gameVersion: string,
  loader: string,
): Promise<UpdateCheckResult | null> {
  const url = new URL(
    `${MODRINTH_API_URL}/${encodeURIComponent(projectIdOrSlug)}/version`,
  );
  url.searchParams.set("game_versions", JSON.stringify([gameVersion]));
  url.searchParams.set("loaders", JSON.stringify([loader.toLowerCase()]));

  {
    const response = await modrinthFetch(url);

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const versions = (await response.json()) as ModrinthVersionResponse[];
    // Prefere a versão estável mais recente; só cai para beta/alpha se o
    // projeto não tiver nenhum release para essa versão/loader.
    const latestVersion = versions.find((version) => version.version_type === "release")
      ?? versions[0];

    if (!latestVersion) {
      return null;
    }

    return {
      latestVersionId: latestVersion.id,
      latestVersionNumber: extractVersionFromFileName(latestVersion.version_number),
      releaseDate: latestVersion.date_published,
      dependencies: {
        required: filterDependencies(latestVersion.dependencies, "required"),
        optional: filterDependencies(latestVersion.dependencies, "optional"),
        incompatible: filterDependencies(
          latestVersion.dependencies,
          "incompatible",
        ),
      },
      latestFile: extractLatestFile(latestVersion.files),
    };
  }
}

function extractLatestFile(
  files: ModrinthVersionFile[] | undefined,
): LatestFileInfo | undefined {
  const primaryFile = files?.find((file) => file.primary) ?? files?.[0];

  if (!primaryFile) {
    return undefined;
  }

  return {
    url: primaryFile.url,
    fileName: primaryFile.filename,
    fileSize: primaryFile.size,
    sha1: primaryFile.hashes?.sha1,
    sha512: primaryFile.hashes?.sha512,
  };
}

function filterDependencies(
  dependencies: ModrinthDependency[],
  dependencyType: ModrinthDependency["dependency_type"],
): ModrinthDependency[] {
  return dependencies.filter(
    (dependency) => dependency.dependency_type === dependencyType,
  );
}

export interface ModrinthProjectMeta {
  id: string;
  slug: string;
  title: string;
}

interface ModrinthProjectResponse {
  id: string;
  slug: string;
  title: string;
}

const projectMetaCache = new Map<
  string,
  Promise<Map<string, ModrinthProjectMeta>>
>();

export function resolveModrinthProjectMeta(
  projectIds: string[],
): Promise<Map<string, ModrinthProjectMeta>> {
  const uniqueIds = Array.from(new Set(projectIds)).sort();
  const cacheKey = uniqueIds.join(",");
  const cached = projectMetaCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const request = fetchProjectMeta(uniqueIds);
  projectMetaCache.set(cacheKey, request);
  return request;
}

export interface ModrinthSearchCandidate {
  projectId: string;
  slug: string;
  title: string;
}

/**
 * Searches Modrinth's public mod index by name. Used for best-effort
 * cross-platform matching (e.g. finding a CurseForge mod's Modrinth
 * counterpart) — there is no official ID crosswalk between the two
 * platforms, so this is a heuristic, not a guaranteed match.
 */
export async function searchModrinthProjects(
  query: string,
  loader: string,
): Promise<ModrinthSearchCandidate[]> {
  try {
    const url = new URL("https://api.modrinth.com/v2/search");
    url.searchParams.set("query", query);
    url.searchParams.set("limit", "5");
    url.searchParams.set(
      "facets",
      JSON.stringify([["project_type:mod"], [`categories:${loader.toLowerCase()}`]]),
    );

    const response = await modrinthFetch(url);

    if (!response.ok) {
      return [];
    }

    const body = (await response.json()) as {
      hits?: Array<{ project_id: string; slug: string; title: string }>;
    };

    return (body.hits ?? []).map((hit) => ({
      projectId: hit.project_id,
      slug: hit.slug,
      title: hit.title,
    }));
  } catch {
    return [];
  }
}

const BULK_CHUNK_SIZE = 100;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchProjectMeta(
  projectIds: string[],
): Promise<Map<string, ModrinthProjectMeta>> {
  const result = new Map<string, ModrinthProjectMeta>();

  // Em lotes: com centenas de ids a URL estourava o limite de tamanho.
  for (const batch of chunkArray(projectIds, BULK_CHUNK_SIZE)) {
    try {
      const url = new URL("https://api.modrinth.com/v2/projects");
      url.searchParams.set("ids", JSON.stringify(batch));

      const response = await modrinthFetch(url);
      if (!response.ok) {
        continue;
      }

      const projects = (await response.json()) as ModrinthProjectResponse[];
      for (const project of projects) {
        result.set(project.id, {
          id: project.id,
          slug: project.slug,
          title: project.title,
        });
      }
    } catch (error) {
      console.warn("[Modrinth] Falha ao resolver metadados de projetos:", error);
    }
  }

  return result;
}

export interface ModrinthInstalledVersion {
  id: string;
  versionNumber: string;
  publishedAt: string;
}

/**
 * Resolve, em lote, as versões que o pack tem instaladas (a partir do id da
 * versão que vem na URL de download do modrinth.index.json). Sem isso não há
 * como saber se existe atualização de verdade.
 */
export async function resolveModrinthInstalledVersions(
  versionIds: string[],
): Promise<Map<string, ModrinthInstalledVersion>> {
  const result = new Map<string, ModrinthInstalledVersion>();
  const uniqueIds = Array.from(new Set(versionIds));

  for (const batch of chunkArray(uniqueIds, BULK_CHUNK_SIZE)) {
    try {
      const url = new URL("https://api.modrinth.com/v2/versions");
      url.searchParams.set("ids", JSON.stringify(batch));

      const response = await modrinthFetch(url);
      if (!response.ok) {
        continue;
      }

      const versions = (await response.json()) as ModrinthVersionResponse[];
      for (const version of versions) {
        result.set(version.id, {
          id: version.id,
          versionNumber: version.version_number,
          publishedAt: version.date_published,
        });
      }
    } catch (error) {
      console.warn("[Modrinth] Falha ao resolver versões instaladas:", error);
    }
  }

  return result;
}
