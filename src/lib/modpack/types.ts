export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type IssueCategory =
  | "REGISTRY_COLLISION"
  | "EARLY_REGISTER_ACCESS"
  | "CONFIG_INCOMPATIBILITY"
  | "CONNECTOR_FAULT"
  | "VERSION_MISMATCH";

export interface CompatibilityIssue {
  id: string;
  category: IssueCategory;
  severity: Severity;
  title: string;
  description: string;
  offendingMods: string[];
  suggestedAction: string;
  affectedResource?: string;
}

export interface ModMetadata {
  modId: string;
  version: string;
  displayName: string;
  dependencies: Array<{
    modId: string;
    versionRange?: string;
    mandatory: boolean;
  }>;
  fileName: string;
}

export interface AnalysisReport {
  timestamp: string;
  issues: CompatibilityIssue[];
  summary: {
    criticalCount: number;
    highCount: number;
    compatible: boolean;
  };
}
