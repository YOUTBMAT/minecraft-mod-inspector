import type { PortCandidate, PortMatch, PortMatchConfidence, PortTargetFormat } from "@/types";
import { checkModrinthUpdate, searchModrinthProjects } from "@/lib/modrinthService";
import { searchCurseForgeMods } from "@/lib/curseforgeService";

interface SourceMod {
  id: string;
  name?: string;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function scoreConfidence(sourceName: string, candidateName: string): PortMatchConfidence {
  const source = normalizeName(sourceName);
  const candidate = normalizeName(candidateName);

  if (!source || !candidate) {
    return "low";
  }
  if (source === candidate) {
    return "high";
  }
  if (candidate.includes(source) || source.includes(candidate)) {
    const lengthDiff = Math.abs(candidate.length - source.length);
    return lengthDiff <= 4 ? "high" : "medium";
  }
  return "low";
}

function deriveStatus(candidates: PortCandidate[]): PortMatch["status"] {
  if (candidates.length === 0) {
    return "unmatched";
  }
  return candidates[0].confidence === "high" ? "matched" : "ambiguous";
}

async function matchOnCurseForge(
  mod: SourceMod,
  gameVersion: string,
  loader: string,
  apiKey: string,
): Promise<PortMatch> {
  const query = mod.name ?? mod.id;
  const results = await searchCurseForgeMods(query, gameVersion, loader, apiKey);

  const candidates: PortCandidate[] = results
    .filter((result) => result.fileId && result.fileName)
    .map((result) => ({
      targetId: result.id,
      targetName: result.name,
      confidence: scoreConfidence(query, result.name),
      fileId: result.fileId,
      fileName: result.fileName as string,
    }))
    .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));

  return {
    sourceModId: mod.id,
    sourceModName: mod.name,
    status: deriveStatus(candidates),
    candidates,
  };
}

async function matchOnModrinth(
  mod: SourceMod,
  gameVersion: string,
  loader: string,
): Promise<PortMatch> {
  const query = mod.name ?? mod.id;
  const results = await searchModrinthProjects(query, loader);

  const candidateChecks = await Promise.all(
    results.map(async (result) => {
      const update = await checkModrinthUpdate(result.projectId, gameVersion, loader);
      if (!update?.latestFile) {
        return null;
      }
      const candidate: PortCandidate = {
        targetId: result.projectId,
        targetName: result.title,
        confidence: scoreConfidence(query, result.title),
        fileName: update.latestFile.fileName,
        downloadUrl: update.latestFile.url,
        fileSize: update.latestFile.fileSize,
        sha1: update.latestFile.sha1,
        sha512: update.latestFile.sha512,
      };
      return candidate;
    }),
  );

  const candidates = candidateChecks
    .filter((candidate): candidate is PortCandidate => candidate !== null)
    .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));

  return {
    sourceModId: mod.id,
    sourceModName: mod.name,
    status: deriveStatus(candidates),
    candidates,
  };
}

function confidenceRank(confidence: PortMatchConfidence): number {
  return { high: 2, medium: 1, low: 0 }[confidence];
}

export interface PortModpackResult {
  matches: PortMatch[];
  requiresCurseForgeApiKey: boolean;
}

export async function matchModpackToPlatform(
  mods: SourceMod[],
  targetFormat: PortTargetFormat,
  gameVersion: string,
  loader: string,
): Promise<PortModpackResult> {
  if (targetFormat === "curseforge") {
    const apiKey = process.env.CURSEFORGE_API_KEY;
    if (!apiKey) {
      return {
        matches: mods.map((mod) => ({
          sourceModId: mod.id,
          sourceModName: mod.name,
          status: "unmatched" as const,
          candidates: [],
        })),
        requiresCurseForgeApiKey: true,
      };
    }

    const matches = await Promise.all(
      mods.map((mod) => matchOnCurseForge(mod, gameVersion, loader, apiKey)),
    );
    return { matches, requiresCurseForgeApiKey: false };
  }

  const matches = await Promise.all(
    mods.map((mod) => matchOnModrinth(mod, gameVersion, loader)),
  );
  return { matches, requiresCurseForgeApiKey: false };
}
