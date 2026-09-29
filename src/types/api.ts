import type { ModMetadata } from "./mod";

export interface ModpackInspectionResult {
  mods: ModMetadata[];
  warnings: string[];
  errors: string[];
}

export interface ApiError {
  message: string;
  code: string;
}
