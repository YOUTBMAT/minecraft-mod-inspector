export interface IncompatibleModEntry {
  modId: string;
  aliases: string[];
  severity: "CRITICAL" | "WARNING";
  reason: string;
  recommendation: string;
  autoDetectedFromLogs?: boolean;
}

export const INCOMPATIBLE_MODS_BASE: IncompatibleModEntry[] = [
  {
    modId: "copperagebackport",
    aliases: ["copper age backport", "copperagebackport-neoforge"],
    severity: "CRITICAL",
    reason: "Colisão de registro nativo ao registrar materiais de cobre no NeoForge 1.21.1.",
    recommendation: "Remova este mod. Os itens já existem nativamente no Minecraft 1.21.1.",
  },
];

const dynamicEntries: IncompatibleModEntry[] = [];

export function checkIncompatibleMod(
  modId: string,
  displayName: string,
  dynamicDb: IncompatibleModEntry[] = dynamicEntries,
): IncompatibleModEntry | null {
  const cleanId = modId.toLowerCase().trim();
  const cleanName = displayName.toLowerCase().trim();
  const fullDb = [...INCOMPATIBLE_MODS_BASE, ...dynamicDb];

  return fullDb.find((entry) => {
    const matchId = entry.modId.toLowerCase() === cleanId;
    const matchAlias = entry.aliases.some((alias) => {
      const normalizedAlias = alias.toLowerCase();
      return cleanId.includes(normalizedAlias) || cleanName.includes(normalizedAlias);
    });
    return matchId || matchAlias;
  }) ?? null;
}

export function learnIncompatibleMod(entry: IncompatibleModEntry): void {
  const exists = dynamicEntries.some((known) => known.modId === entry.modId);
  if (!exists) {
    dynamicEntries.push({ ...entry, autoDetectedFromLogs: true });
  }
}

export function getDynamicIncompatibleMods(): IncompatibleModEntry[] {
  return dynamicEntries.map((entry) => ({ ...entry, aliases: [...entry.aliases] }));
}
