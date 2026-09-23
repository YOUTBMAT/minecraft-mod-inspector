import type {
  InstalledMod,
  ModAnalysisReport,
  ModStatusType,
} from "@/types";
import { checkModrinthUpdate } from "@/lib/modrinthService";
import type { CurseForgeResolvedMod } from "@/lib/curseforgeService";

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

  if (source === "curseforge") {
    for (const installedMod of installedMods) {
      const resolvedMod = curseForgeMods?.get(installedMod.id);
      const report = reports.get(installedMod.id);

      if (!resolvedMod || !report) {
        continue;
      }

      if (resolvedMod.updateAvailable) {
        report.status = "SAFE_UPDATE";
        report.latestVersion = resolvedMod.latestVersion;
        report.latestFile = createCurseForgeLatestFile(resolvedMod);
        roots.push({
          rootId: installedMod.id,
          requirements: toCurseForgeRequirements(
            installedMod.id,
            resolvedMod,
            installedMod.id,
          ),
        });
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
          addIncompatibleConflicts(report, installedMap, update);
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
    );
  }

  applyGlobalConstraintConflicts(constraints, reports);

  for (const report of reports.values()) {
    report.requiredNewMods = unique(report.requiredNewMods);
    report.cascadingUpdates = unique(report.cascadingUpdates);
    report.conflictingMods = unique(report.conflictingMods);
    report.conflictDetails = unique(report.conflictDetails ?? []);
    report.status = getFinalStatus(report);
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
        addCycleConflict(report, [...current.path, requirement.targetId]);
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
) {
  for (const [targetId, records] of constraints) {
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

      for (const record of [...firstGroup, ...otherGroup]) {
        const report = reports.get(record.rootId);
        if (!report) {
          continue;
        }

        report.status = "CONFLICT";
        report.conflictingMods.push(targetId);
        report.conflictDetails = [...(report.conflictDetails ?? []), detail];
      }
    }
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
) {
  if (!report) {
    return;
  }

  report.status = "CONFLICT";
  report.conflictingMods.push(cycle[cycle.length - 1]);
  report.conflictDetails = [
    ...(report.conflictDetails ?? []),
    `Ciclo de dependências detectado: ${formatChain(cycle)}.`,
  ];
}

function addIncompatibleConflicts(
  report: ModAnalysisReport,
  installedMap: Map<string, string>,
  update: ModrinthUpdate,
) {
  for (const dependency of update?.dependencies.incompatible ?? []) {
    if (!installedMap.has(dependency.project_id)) {
      continue;
    }

    report.status = "CONFLICT";
    report.conflictingMods.push(dependency.project_id);
    report.conflictDetails = [
      ...(report.conflictDetails ?? []),
      `Conflito na cadeia: [${report.modId}] é incompatível com [${dependency.project_id}].`,
    ];
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

function getFinalStatus(report: ModAnalysisReport): ModStatusType {
  if (report.conflictDetails && report.conflictDetails.length > 0) {
    return "CONFLICT";
  }

  if (report.requiredNewMods.length > 0) {
    return "MISSING_DEPENDENCY";
  }

  if (report.cascadingUpdates.length > 0) {
    return "CASCADING_REQUIRED";
  }

  return report.status === "UP_TO_DATE" ? "UP_TO_DATE" : "SAFE_UPDATE";
}