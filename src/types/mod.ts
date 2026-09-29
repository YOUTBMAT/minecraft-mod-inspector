export type ModLoader = "fabric" | "forge" | "neoforge" | "quilt" | "unknown";

export interface ModMetadata {
  id: string;
  name: string;
  version: string;
  loader: ModLoader;
  fileName: string;
  dependencies: string[];
}
