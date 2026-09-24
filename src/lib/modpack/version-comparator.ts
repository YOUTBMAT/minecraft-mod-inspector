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

/** Normaliza versões de mods preservando padrões comuns do Minecraft. */
export function normalizeModVersion(rawVersion: string): string {
  if (!rawVersion) {
    return "0.0.0";
  }

  let cleaned = rawVersion.trim().toLowerCase();
  if (cleaned.startsWith("v")) {
    cleaned = cleaned.substring(1);
  }

  const matches = cleaned.match(/\d+(\.\d+)+/g);
  if (!matches || matches.length === 0) {
    return cleaned;
  }

  const targetVersion = matches.length > 1
    ? matches[matches.length - 1]
    : matches[0];
  const parts = targetVersion.split(".");

  if (parts.length === 1) {
    return `${targetVersion}.0.0`;
  }
  if (parts.length === 2) {
    return `${targetVersion}.0`;
  }

  return parts.slice(0, 3).join(".");
}

/** Detecta o canal de release (Alpha/Beta/Release). */
export function detectReleaseChannel(versionString: string): ReleaseChannel {
  const lower = versionString.toLowerCase();
  if (lower.includes("alpha") || lower.includes("-a")) {
    return "alpha";
  }
  if (lower.includes("beta") || lower.includes("-b") || lower.includes("rc")) {
    return "beta";
  }
  return "release";
}

/** Compara SemVer e usa fallback textual quando o formato não é SemVer válido. */
export function compareModVersions(
  currentRaw: string,
  latestRaw: string,
  allowChannels: ReleaseChannel[] = ["release", "beta", "alpha"],
): VersionCheckResult {
  const latestChannel = detectReleaseChannel(latestRaw);

  if (!allowChannels.includes(latestChannel)) {
    return {
      currentVersion: currentRaw,
      latestVersion: latestRaw,
      hasUpdate: false,
      channel: latestChannel,
      normalizedCurrent: currentRaw,
      normalizedLatest: latestRaw,
    };
  }

  const normalizedCurrent = normalizeModVersion(currentRaw);
  const normalizedLatest = normalizeModVersion(latestRaw);
  const validCurrent = semver.valid(normalizedCurrent);
  const validLatest = semver.valid(normalizedLatest);
  const hasUpdate = validCurrent && validLatest
    ? semver.gt(validLatest, validCurrent)
    : normalizedCurrent !== normalizedLatest && latestRaw !== currentRaw;

  return {
    currentVersion: currentRaw,
    latestVersion: latestRaw,
    hasUpdate,
    channel: latestChannel,
    normalizedCurrent,
    normalizedLatest,
  };
}
