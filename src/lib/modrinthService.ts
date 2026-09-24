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

  const request = fetchModrinthUpdate(projectIdOrSlug, gameVersion, loader);
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

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": MODRINTH_USER_AGENT,
      },
    });

    if (!response.ok) {
      return null;
    }

    const versions = (await response.json()) as ModrinthVersionResponse[];
    const latestVersion = versions[0];

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
  } catch {
    return null;
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

    const response = await fetch(url, {
      headers: { "User-Agent": MODRINTH_USER_AGENT },
    });

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

async function fetchProjectMeta(
  projectIds: string[],
): Promise<Map<string, ModrinthProjectMeta>> {
  if (projectIds.length === 0) {
    return new Map();
  }

  try {
    const url = new URL("https://api.modrinth.com/v2/projects");
    url.searchParams.set("ids", JSON.stringify(projectIds));

    const response = await fetch(url, {
      headers: {
        "User-Agent": MODRINTH_USER_AGENT,
      },
    });

    if (!response.ok) {
      return new Map();
    }

    const projects = (await response.json()) as ModrinthProjectResponse[];
    return new Map(
      projects.map((project) => [
        project.id,
        { id: project.id, slug: project.slug, title: project.title },
      ]),
    );
  } catch {
    return new Map();
  }
}
