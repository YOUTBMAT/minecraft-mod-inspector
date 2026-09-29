import type { ModpackInspectionResult } from "@/types/api";

export async function inspectModpack(file: ArrayBuffer): Promise<ModpackInspectionResult> {
  void file;

  return {
    mods: [],
    warnings: [],
    errors: [],
  };
}
