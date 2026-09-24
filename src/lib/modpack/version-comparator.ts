import semver from "semver";

export type ReleaseChannel = "release" | "beta" | "alpha";

export interface VersionCheckResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  channel: ReleaseChannel;
  normalizedCurrent: string;
  normalizedLatest: string;
}

/** Normaliza identificadores de versão comuns em mods Minecraft para SemVer. */
export function normalizeModVersion(rawVersion: string): string {
  if (!rawVersion) {
    return "0.0.0";
  }

  let cleaned = rawVersion.trim();
  cleaned = cleaned.replace(/^(?:mc)?\d+\.\d+(?:\.\d+)?[-_]/i, "");
  cleaned = cleaned.replace(/[-_](?:neoforge|forge|fabric|quilt)\b.*$/i, "");

  const versionMatch = cleaned.match(/\d+\.\d+(?:\.\d+)?/);
  if (!versionMatch) {
    return "0.0.0";
  }

  const numericParts = versionMatch[0].split(".");
  let baseVersion = numericParts.length === 2
    ? `${versionMatch[0]}.0`
    : versionMatch[0];
  const suffix = cleaned.slice((versionMatch.index ?? 0) + versionMatch[0].length);

  if (/(?:^|[-_.+])(?:alpha|a)(?:[-_.+\d]|$)/i.test(suffix)) {
    baseVersion += "-alpha";
  } else if (/(?:^|[-_.+])(?:beta|b)(?:[-_.+\d]|$)/i.test(suffix)) {
    baseVersion += "-beta";
  } else if (/(?:^|[-_.+])rc(?:[-_.+\d]|$)/i.test(suffix)) {
    baseVersion += "-rc";
  }

  return semver.valid(baseVersion) ?? "0.0.0";
}

export function detectReleaseChannel(versionString: string): ReleaseChannel {
  const lower = versionString.toLowerCase();
  if (/(?:alpha|[-_.]a(?:[-_.\d]|$))/.test(lower)) {
    return "alpha";
  }
  if (/(?:beta|rc|[-_.]b(?:[-_.\d]|$))/.test(lower)) {
    return "beta";
  }
  return "release";
}

export function compareModVersions(
  currentRaw: string,
  latestRaw: string,
  allowChannels: ReleaseChannel[] = ["release", "beta"],
): VersionCheckResult {
  const normalizedCurrent = normalizeModVersion(currentRaw);
  const normalizedLatest = normalizeModVersion(latestRaw);
  const channel = detectReleaseChannel(latestRaw);
  const hasUpdate = allowChannels.includes(channel) &&
    semver.gt(normalizedLatest, normalizedCurrent);

  return {
    currentVersion: currentRaw,
    latestVersion: latestRaw,
    hasUpdate,
    channel,
    normalizedCurrent,
    normalizedLatest,
  };
}
