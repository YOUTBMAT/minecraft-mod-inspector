import type { KnownConflictWarning, KnownModConflictRule } from "@/types";

/**
 * Curated list of mods that are documented (by the mod authors themselves,
 * or by long-standing community consensus) to conflict with one another.
 * This is a starting point, not an exhaustive database — matching is done
 * by slug/name aliases since installed-mod identifiers differ between
 * Modrinth (project id/slug) and CurseForge (numeric project id).
 *
 * Extend this list as new confirmed conflicts are found; each rule's
 * `reason` should stay specific enough that a user can verify it.
 */
export const KNOWN_MOD_CONFLICTS: KnownModConflictRule[] = [
  {
    id: "optifine-vs-sodium",
    modA: ["optifine"],
    modB: ["sodium", "rubidium", "embeddium"],
    severity: "critical",
    reason:
      "OptiFine and Sodium (or its forks Rubidium/Embeddium) both replace Minecraft's rendering engine and are not compatible with each other — running both typically crashes on startup or causes severe rendering glitches.",
  },
  {
    id: "optifine-vs-iris",
    modA: ["optifine"],
    modB: ["iris", "iris-shaders"],
    severity: "critical",
    reason:
      "OptiFine and Iris both hook the renderer to add shader support; they conflict directly. Use Iris (with Sodium) instead of OptiFine for shaders on modern Fabric/Forge versions.",
  },
  {
    id: "jei-vs-rei-vs-nei",
    modA: ["jei", "just-enough-items"],
    modB: ["rei", "roughly-enough-items", "not-enough-items", "nei"],
    severity: "warning",
    reason:
      "Multiple recipe-viewer mods (JEI, REI, NEI) installed together are redundant and have historically caused UI/keybind clashes and crashes on some loader versions. Keep only the one the modpack was built around.",
  },
  {
    id: "duplicate-minimap-mods",
    modA: ["journeymap"],
    modB: ["xaeros-minimap", "xaeros-world-map"],
    severity: "warning",
    reason:
      "JourneyMap and Xaero's Minimap both hook world rendering and keybinds for a minimap; running both is redundant and can cause keybind conflicts or duplicate waypoint rendering.",
  },
  {
    id: "fabric-loader-with-forge-only-mods",
    modA: ["fabric-api"],
    modB: ["forge"],
    severity: "critical",
    reason:
      "A Forge-only mod cannot run on the Fabric loader (and vice versa) — this indicates a loader mismatch in the pack, which will fail to launch rather than degrade gracefully.",
  },
  {
    id: "double-optimization-suite",
    modA: ["lithium"],
    modB: ["hyperium", "phosphor"],
    severity: "warning",
    reason:
      "Lithium already includes the optimizations that older standalone mods like Phosphor/Hyperium provide; running both is redundant and has occasionally caused double-patched behavior on shared mixins.",
  },
];

const MOD_INFO_SEPARATOR = "|";

interface MatchableMod {
  id: string;
  name?: string;
  slug?: string;
}

function normalizeAlias(value: string): string {
  return value.toLowerCase().replace(/[\s_]+/g, "-").trim();
}

function buildMatchTokens(mod: MatchableMod): string[] {
  const tokens = [mod.id, mod.name, mod.slug]
    .filter((value): value is string => Boolean(value))
    .map(normalizeAlias);
  return Array.from(new Set(tokens));
}

function matchesAnyAlias(tokens: string[], aliases: string[]): boolean {
  const normalizedAliases = aliases.map(normalizeAlias);
  return tokens.some((token) =>
    normalizedAliases.some(
      (alias) => token === alias || token.includes(alias) || alias.includes(token),
    ),
  );
}

/**
 * Detects installed mods that match a known-conflict rule.
 * Matching is best-effort by name/slug/id alias, since the analyzer does
 * not always have a canonical identifier for both Modrinth and CurseForge.
 */
export function detectKnownConflicts(
  installedMods: MatchableMod[],
): KnownConflictWarning[] {
  const warnings: KnownConflictWarning[] = [];
  const seenPairs = new Set<string>();

  for (const rule of KNOWN_MOD_CONFLICTS) {
    const matchesA = installedMods.filter((mod) =>
      matchesAnyAlias(buildMatchTokens(mod), rule.modA),
    );
    const matchesB = installedMods.filter((mod) =>
      matchesAnyAlias(buildMatchTokens(mod), rule.modB),
    );

    for (const modA of matchesA) {
      for (const modB of matchesB) {
        if (modA.id === modB.id) {
          continue;
        }

        const pairKey = [rule.id, modA.id, modB.id].sort().join(MOD_INFO_SEPARATOR);
        if (seenPairs.has(pairKey)) {
          continue;
        }
        seenPairs.add(pairKey);

        warnings.push({
          ruleId: rule.id,
          modAId: modA.id,
          modAName: modA.name,
          modBId: modB.id,
          modBName: modB.name,
          severity: rule.severity,
          reason: rule.reason,
        });
      }
    }
  }

  return warnings;
}
