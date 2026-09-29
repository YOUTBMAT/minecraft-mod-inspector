import type { ModMetadata } from "@/types/mod";

export interface DependencyIssue {
  modId: string;
  dependency: string;
  message: string;
}

export function resolveDependencyIssues(mods: ModMetadata[]): DependencyIssue[] {
  const availableModIds = new Set(mods.map((mod) => mod.id));

  return mods.flatMap((mod) =>
    mod.dependencies
      .filter((dependency) => !availableModIds.has(dependency))
      .map((dependency) => ({
        modId: mod.id,
        dependency,
        message: `Dependência ausente: ${dependency}`,
      })),
  );
}
