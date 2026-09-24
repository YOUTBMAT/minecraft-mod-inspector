import type {
  InstalledMod,
  ModAnalysisReport,
  ModStatusType,
} from "@/types";
import { checkModrinthUpdate } from "@/lib/modrinthService";
import {
  FABRIC_BRIDGE_PROJECT_IDS,
  type CurseForgeResolvedMod,
} from "@/lib/curseforgeService";

const FORGIFIED_FABRIC_API_ID = "882495";

type ModrinthUpdate = Awaited<ReturnType<typeof checkModrinthUpdate>>;

interface DependencyRequirement {
  targetId: string;
  constraint?: string;
  path: string[];
  rootId: string;
}

interface ConstraintRecord extends DependencyRequirement {
  sourceId: string;
}

interface RootGraph {
  rootId: string;
  requirements: DependencyRequirement[];
}

export async function analyzeModpack(
  installedMods: InstalledMod[],
  gameVersion: string,
  loader: string,
  source: "modrinth" | "curseforge" = "modrinth",
  curseForgeMods?: Map<string, CurseForgeResolvedMod>,
): Promise<Map<string, ModAnalysisReport>> {
  const installedMap = new Map(
    installedMods.map((mod) => [mod.id, mod.currentVersion]),
  );
  const reports = new Map(
    installedMods.map((installedMod) => [
      installedMod.id,
      createReport(installedMod),
    ]),
  );
  const roots: RootGraph[] = [];
  const constraints = new Map<string, ConstraintRecord[]>();
  const modrinthUpdates = new Map<string, ModrinthUpdate>();
  const conflictingModIds = new Set<string>();

  if (source === "curseforge") {
    for (const installedMod of installedMods) {
      const resolvedMod = curseForgeMods?.get(installedMod.id);
      const report = reports.get(installedMod.id);

      if (!resolvedMod || !report) {
        continue;
      }

      if (loader.toLowerCase() === "neoforge" && resolvedMod.requiresFabricBridge) {
        report.requiredNewMods.push(...FABRIC_BRIDGE_PROJECT_IDS);
        report.recommendations.push(
          `${resolvedMod.displayName} parece ser um mod Fabric em NeoForge. Instale Sinytra Connector e Forgified Fabric API; isso é uma recomendação de compatibilidade, não um conflito direto.`,
        );
      }

      if (resolvedMod.updateAvailable) {
        report.status = "SAFE_UPDATE";
        report.latestVersion = resolvedMod.latestVersion;
        report.latestFile = createCurseForgeLatestFile(resolvedMod);
      }

      const requirements = toCurseForgeRequirements(
        installedMod.id,
        resolvedMod,
        installedMod.id,
      );
      if (requirements.length > 0) {
        roots.push({ rootId: installedMod.id, requirements });
      }

      if (
        loader.toLowerCase() === "neoforge" &&
        isContinuityMod(resolvedMod.displayName, resolvedMod.projectId) &&
        !report.requiredNewMods.includes("883520")
      ) {
        report.requiredNewMods.push("883520");
        report.recommendations.push(
          "Sinytra Connector será incluído no manifesto para satisfazer a dependência do Continuity.",
        );
      }
    }
  } else {
    await Promise.all(
      installedMods.map(async (installedMod) => {
        const update = await checkModrinthUpdate(
          installedMod.id,
          gameVersion,
          loader,
        );
        modrinthUpdates.set(installedMod.id, update);

        const report = reports.get(installedMod.id);
        if (!report || !update) {
          return;
        }

        report.latestFile = update.latestFile;
        if (update.latestVersionNumber !== installedMod.currentVersion) {
          report.status = "SAFE_UPDATE";
          report.latestVersion = update.latestVersionNumber;
          addIncompatibleConflicts(
            report,
            installedMap,
            update,
            reports,
            conflictingModIds,
          );
          roots.push({
            rootId: installedMod.id,
            requirements: toModrinthRequirements(
              installedMod.id,
              update,
              installedMod.id,
            ),
          });
        }
      }),
    );
  }

  for (const root of roots) {
    await traverseRoot(
      root,
      source,
      installedMap,
      reports,
      curseForgeMods,
      modrinthUpdates,
      gameVersion,
      loader,
      constraints,
      conflictingModIds,
    );
  }

  applyGlobalConstraintConflicts(
    constraints,
    reports,
    loader,
    conflictingModIds,
  );

  for (const report of reports.values()) {
    report.requiredNewMods = unique(report.requiredNewMods);
    report.recommendations = unique(report.recommendations);
    report.cascadingUpdates = unique(report.cascadingUpdates);
    report.conflictingMods = unique(report.conflictingMods);
    report.conflictDetails = unique(report.conflictDetails ?? []);
    report.status = getFinalStatus(report, conflictingModIds);
  }

  return reports;
}

async function traverseRoot(
  root: RootGraph,
  source: "modrinth" | "curseforge",
  installedMap: Map<string, string>,
  reports: Map<string, ModAnalysisReport>,
  curseForgeMods: Map<string, CurseForgeResolvedMod> | undefined,
  modrinthUpdates: Map<string, ModrinthUpdate>,
  gameVersion: string,
  loader: string,
  constraints: Map<string, ConstraintRecord[]>,
  conflictingModIds: Set<string>,
): Promise<void> {
  const queue = [{
    sourceId: root.rootId,
    path: [root.rootId],
    requirements: root.requirements,
  }];
  const expanded = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const requirement of current.requirements) {
      if (
        source === "curseforge" &&
        shouldIgnoreIncompatibleCurseForgeDependency(
          requirement,
          curseForgeMods,
        )
      ) {
        continue;
      }

      const records = constraints.get(requirement.targetId) ?? [];
      records.push({ ...requirement, sourceId: current.sourceId });
      constraints.set(requirement.targetId, records);

      const report = reports.get(root.rootId);
      if (report && !installedMap.has(requirement.targetId)) {
        report.requiredNewMods.push(requirement.targetId);
      } else if (
        report &&
        requirement.targetId !== root.rootId &&
        requiresCascade(requirement, installedMap, curseForgeMods)
      ) {
        report.cascadingUpdates.push(requirement.targetId);
      }

      if (current.path.includes(requirement.targetId)) {
        addCycleConflict(
          report,
          [...current.path, requirement.targetId],
          reports,
          conflictingModIds,
        );
        continue;
      }

      if (expanded.has(requirement.targetId)) {
        continue;
      }

      expanded.add(requirement.targetId);
      const nestedRequirements = await getRequirements(
        requirement.targetId,
        source,
        curseForgeMods,
        modrinthUpdates,
        gameVersion,
        loader,
        root.rootId,
        [...current.path, requirement.targetId],
      );

      if (nestedRequirements.length > 0) {
        queue.push({
          sourceId: requirement.targetId,
          path: [...current.path, requirement.targetId],
          requirements: nestedRequirements,
        });
      }
    }
  }
}

async function getRequirements(
  modId: string,
  source: "modrinth" | "curseforge",
  curseForgeMods: Map<string, CurseForgeResolvedMod> | undefined,
  modrinthUpdates: Map<string, ModrinthUpdate>,
  gameVersion: string,
  loader: string,
  rootId: string,
  path: string[],
): Promise<DependencyRequirement[]> {
  if (source === "curseforge") {
    return toCurseForgeRequirements(
      modId,
      curseForgeMods?.get(modId),
      rootId,
      path,
    );
  }

  if (!modrinthUpdates.has(modId)) {
    modrinthUpdates.set(
      modId,
      await checkModrinthUpdate(modId, gameVersion, loader),
    );
  }

  return toModrinthRequirements(
    modId,
    modrinthUpdates.get(modId),
    rootId,
    path,
  );
}

function toCurseForgeRequirements(
  sourceId: string,
  mod: CurseForgeResolvedMod | undefined,
  rootId: string,
  path: string[] = [rootId],
): DependencyRequirement[] {
  return (mod?.requiredDependencies ?? []).map((dependency) => ({
    targetId: dependency.projectId,
    constraint: dependency.fileId,
    path,
    rootId,
  }));
}

function toModrinthRequirements(
  sourceId: string,
  update: ModrinthUpdate | undefined,
  rootId: string,
  path: string[] = [rootId],
): DependencyRequirement[] {
  return (update?.dependencies.required ?? []).map((dependency) => ({
    targetId: dependency.project_id,
    constraint: dependency.version_id || undefined,
    path,
    rootId,
  }));
}

function applyGlobalConstraintConflicts(
  constraints: Map<string, ConstraintRecord[]>,
  reports: Map<string, ModAnalysisReport>,
  loader: string,
  conflictingModIds: Set<string>,
) {
  for (const [targetId, records] of constraints) {
    if (shouldIgnoreForgifiedFabricApiConflict(targetId, records, loader)) {
      continue;
    }

    const grouped = new Map<string, ConstraintRecord[]>();
    for (const record of records) {
      if (!record.constraint) {
        continue;
      }

      const targetRecords = grouped.get(record.constraint) ?? [];
      targetRecords.push(record);
      grouped.set(record.constraint, targetRecords);
    }

    if (grouped.size < 2) {
      continue;
    }

    const groups = Array.from(grouped.values());
    const firstGroup = groups[0];
    for (const otherGroup of groups.slice(1)) {
      const first = firstGroup[0];
      const other = otherGroup[0];
      const detail = `Conflito na cadeia: ${formatChain(first.path)} exige ${targetId} (${first.constraint}), mas ${formatChain(other.path)} exige ${targetId} (${other.constraint}).`;

      const involvedIds = new Set([
        targetId,
        ...firstGroup.flatMap((record) => [record.sourceId, record.targetId]),
        ...otherGroup.flatMap((record) => [record.sourceId, record.targetId]),
      ]);
      markDirectConflictReports(
        reports,
        involvedIds,
        targetId,
        detail,
        conflictingModIds,
      );
    }
  }
}

function shouldIgnoreForgifiedFabricApiConflict(
  targetId: string,
  records: ConstraintRecord[],
  loader: string,
): boolean {
  return (loader.toLowerCase() === "forge" || loader.toLowerCase() === "neoforge") &&
    (targetId === FORGIFIED_FABRIC_API_ID || records.some(
      (record) => record.sourceId === FORGIFIED_FABRIC_API_ID ||
        record.targetId === FORGIFIED_FABRIC_API_ID,
    ));
}

function markDirectConflictReports(
  reports: Map<string, ModAnalysisReport>,
  involvedIds: Set<string>,
  conflictingId: string,
  detail: string,
  conflictingModIds: Set<string>,
): void {
  for (const involvedId of involvedIds) {
    const report = reports.get(involvedId);
    if (!report) {
      continue;
    }

    conflictingModIds.add(involvedId);
    if (conflictingId !== involvedId) {
      report.conflictingMods.push(conflictingId);
    }
    report.conflictDetails = [...(report.conflictDetails ?? []), detail];
  }
}

function requiresCascade(
  requirement: DependencyRequirement,
  installedMap: Map<string, string>,
  curseForgeMods: Map<string, CurseForgeResolvedMod> | undefined,
): boolean {
  if (!installedMap.has(requirement.targetId)) {
    return false;
  }

  if (!requirement.constraint) {
    return true;
  }

  const installedDependency = curseForgeMods?.get(requirement.targetId);
  if (installedDependency) {
    return installedDependency.fileId !== requirement.constraint;
  }

  const installedVersion = installedMap.get(requirement.targetId);
  return installedVersion !== "unknown" && installedVersion !== requirement.constraint;
}

function shouldIgnoreIncompatibleCurseForgeDependency(
  requirement: DependencyRequirement,
  curseForgeMods: Map<string, CurseForgeResolvedMod> | undefined,
): boolean {
  const dependency = curseForgeMods?.get(requirement.targetId);
  return dependency !== undefined && !dependency.loaderCompatible;
}

function addCycleConflict(
  report: ModAnalysisReport | undefined,
  cycle: string[],
  reports: Map<string, ModAnalysisReport>,
  conflictingModIds: Set<string>,
) {
  if (!report) {
    return;
  }

  const detail = `Ciclo de dependências detectado: ${formatChain(cycle)}.`;
  for (const modId of new Set(cycle)) {
    const directReport = reports.get(modId);
    if (!directReport) {
      continue;
    }

    conflictingModIds.add(modId);
    directReport.conflictingMods.push(
      ...cycle.filter((cycleModId) => cycleModId !== modId),
    );
    directReport.conflictDetails = [
      ...(directReport.conflictDetails ?? []),
      detail,
    ];
  }
}

function addIncompatibleConflicts(
  report: ModAnalysisReport,
  installedMap: Map<string, string>,
  update: ModrinthUpdate,
  reports: Map<string, ModAnalysisReport>,
  conflictingModIds: Set<string>,
) {
  for (const dependency of update?.dependencies.incompatible ?? []) {
    if (!installedMap.has(dependency.project_id)) {
      continue;
    }

    conflictingModIds.add(report.modId);
    report.conflictingMods.push(dependency.project_id);
    report.conflictDetails = [
      ...(report.conflictDetails ?? []),
      `Conflito na cadeia: [${report.modId}] é incompatível com [${dependency.project_id}].`,
    ];
    const dependencyReport = reports.get(dependency.project_id);
    if (dependencyReport) {
      conflictingModIds.add(dependencyReport.modId);
      dependencyReport.conflictingMods.push(report.modId);
      dependencyReport.conflictDetails = [
        ...(dependencyReport.conflictDetails ?? []),
        `Conflito na cadeia: [${report.modId}] é incompatível com [${dependency.project_id}].`,
      ];
    }
  }
}

function createReport(installedMod: InstalledMod): ModAnalysisReport {
  return {
    modId: installedMod.id,
    modName: installedMod.name,
    installedVersion: installedMod.currentVersion,
    status: "UP_TO_DATE",
    latestVersion: installedMod.currentVersion,
    requiredNewMods: [],
    cascadingUpdates: [],
    conflictingMods: [],
    recommendations: [],
  };
}

function createCurseForgeLatestFile(
  mod: CurseForgeResolvedMod,
) {
  return {
    url: mod.latestDownloadUrl ?? "",
    fileName: mod.latestFileName ?? mod.latestVersion,
    fileId: mod.latestFileId,
  };
}

function formatChain(path: string[]) {
  return path.map((part) => `[${part}]`).join(" -> ");
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function getFinalStatus(
  report: ModAnalysisReport,
  conflictingModIds: Set<string>,
): ModStatusType {
  if (conflictingModIds.has(report.modId)) {
    return "CONFLICT";
  }

  if (report.requiredNewMods.length > 0) {
    return "MISSING_DEPENDENCY";
  }

  if (report.cascadingUpdates.length > 0) {
    return "CASCADING_REQUIRED";
  }

  if (isUnknownVersion(report.installedVersion) || isUnknownVersion(report.latestVersion)) {
    return "UNKNOWN";
  }

  return report.status === "UP_TO_DATE" ? "UP_TO_DATE" : "SAFE_UPDATE";
}

function isUnknownVersion(version: string | undefined): boolean {
  return !version || /^(?:não identificada|arquivo unknown)$/i.test(version.trim());
}

function isContinuityMod(displayName: string, projectId: string): boolean {
  return projectId.toLowerCase() === "continuity" ||
    displayName.toLowerCase().replace(/[\s:_-]+/g, "").includes("continuity");
}