import type { CompatibilityIssue, ModMetadata } from "./types";

export function validateModpackCompatibility(
  mods: ModMetadata[],
): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];
  const backportMods = mods.filter((mod) => {
    const modId = mod.modId.toLowerCase();
    return (
      modId.includes("copperage") ||
      modId.includes("vanillabackport") ||
      mod.fileName.toLowerCase().includes("backport")
    );
  });

  if (backportMods.length > 1) {
    issues.push({
      id: "RULE_BACKPORT_DUPLICATION",
      category: "REGISTRY_COLLISION",
      severity: "CRITICAL",
      title: "Múltiplos Mods de Backport Instalados",
      description: `Foram detectados ${backportMods.length} mods que podem registrar os mesmos materiais do Minecraft 1.21.1.`,
      offendingMods: backportMods.map((mod) => mod.fileName),
      suggestedAction: "Deixe apenas um mod de backport no modpack para evitar colisões nos registros do NeoForge.",
    });
  }

  return issues;
}
