export interface CurseForgeManifest {
  name: string;
  version: string;
  minecraft: {
    version: string;
    modLoaders: Array<{
      id: string;
      primary?: boolean;
    }>;
  };
  files: Array<{
    projectID: number;
    fileID: number;
    required: boolean;
  }>;
}

export interface ModrinthIndex {
  name: string;
  versionId: string;
  dependencies: {
    minecraft: string;
    "fabric-loader"?: string;
    forge?: string;
    neoforge?: string;
    "quilt-loader"?: string;
  };
  files: Array<{
    path: string;
    downloads: string[];
    fileSize?: number;
    hashes?: {
      sha1?: string;
      sha512?: string;
    };
  }>;
}

export interface ModrinthDependency {
  version_id: string;
  project_id: string;
  file_name: string;
  dependency_type: "required" | "optional" | "incompatible" | "embedded";
}

export interface UnifiedModpack {
  format: "curseforge" | "modrinth";
  name: string;
  gameVersion: string;
  loader: "fabric" | "forge" | "neoforge" | "quilt";
  loaderVersion: string;
  mods: Array<{
    id: string;
    fileId?: string | number;
    name?: string;
    version?: string;
  }>;
}

export type ModStatusType =
  | "UP_TO_DATE"
  | "SAFE_UPDATE"
  | "CASCADING_REQUIRED"
  | "CONFLICT"
  | "MISSING_DEPENDENCY";

export interface InstalledMod {
  id: string;
  currentVersion: string;
  name?: string;
}

export interface LatestFileInfo {
  url: string;
  fileName: string;
  fileSize?: number;
  sha1?: string;
  sha512?: string;
}

export interface ModAnalysisReport {
  modId: string;
  modName?: string;
  installedVersion?: string;
  status: ModStatusType;
  latestVersion: string;
  requiredNewMods: string[];
  cascadingUpdates: string[];
  conflictingMods: string[];
  latestFile?: LatestFileInfo;
}

export type CrashType =
  | "JAVA_VERSION_MISMATCH"
  | "MISSING_DEPENDENCY"
  | "MIXIN_CONFLICT"
  | "OUT_OF_MEMORY"
  | "DUPLICATE_MOD_ID"
  | "INCOMPATIBLE_MODS"
  | "CORRUPTED_MOD_FILE"
  | "UNKNOWN";

export interface CrashAnalysisResult {
  type: CrashType;
  title: string;
  suspectedMod?: string;
  details: string;
  recommendation: string;
}

export type ConflictSeverity = "warning" | "critical";

export interface KnownModConflictRule {
  id: string;
  modA: string[];
  modB: string[];
  severity: ConflictSeverity;
  reason: string;
}

export interface KnownConflictWarning {
  ruleId: string;
  modAId: string;
  modAName?: string;
  modBId: string;
  modBName?: string;
  severity: ConflictSeverity;
  reason: string;
}

/**
 * Cross-platform "port" feature: converts a modpack from one platform's
 * format to the other. There is no official ID mapping between Modrinth
 * and CurseForge, so matches are found by searching the target platform
 * by mod name and are inherently best-effort — always require human
 * confirmation before export, never auto-apply a match silently.
 */
export type PortTargetFormat = "curseforge" | "modrinth";

export type PortMatchConfidence = "high" | "medium" | "low";

export interface PortCandidate {
  targetId: string;
  targetName: string;
  confidence: PortMatchConfidence;
  fileId?: string;
  fileName: string;
  downloadUrl?: string;
  fileSize?: number;
  sha1?: string;
  sha512?: string;
}

export type PortMatchStatus = "matched" | "ambiguous" | "unmatched";

export interface PortMatch {
  sourceModId: string;
  sourceModName?: string;
  status: PortMatchStatus;
  candidates: PortCandidate[];
}
