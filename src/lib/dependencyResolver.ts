import type {
  InstalledMod,
  ModAnalysisReport,
  ModStatusType,
} from "@/types";
import { checkModrinthUpdate } from "@/lib/modrinthService";
import type { CurseForgeResolvedMod } from "@/lib/curseforgeService";

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
  const reports = new Map<string, ModAnalysisReport>();

  for (const installedMod of installedMods) {
    const report: ModAnalysisReport = {
      modId: installedMod.id,
      modName: installedMod.name,
      installedVersion: installedMod.currentVersion,
      status: "UP_TO_DATE",
      latestVersion: installedMod.currentVersion,
      requiredNewMods: [],
      cascadingUpdates: [],
      conflictingMods: [],
    };

    if (source === "curseforge") {
      const curseForgeMod = curseForgeMods?.get(installedMod.id);
      if (curseForgeMod?.updateAvailable) {
        report.latestVersion = curseForgeMod.latestVersion;
        report.status = "SAFE_UPDATE";
        if (curseForgeMod.latestDownloadUrl) {
          report.latestFile = {
            url: curseForgeMod.latestDownloadUrl,
            fileName: curseForgeMod.latestFileName ?? curseForgeMod.latestVersion,
          };
        }
      }
      reports.set(installedMod.id, report);
      continue;
    }

    const update = await checkModrinthUpdate(
      installedMod.id,
      gameVersion,
      loader,
    );

    if (!update || update.latestVersionNumber === installedMod.currentVersion) {
      if (update?.latestFile) {
        report.latestFile = update.latestFile;
      }
      reports.set(installedMod.id, report);
      continue;
    }

    report.latestVersion = update.latestVersionNumber;
    report.latestFile = update.latestFile;

    const conflictingMod = update.dependencies.incompatible.find((dependency) =>
      installedMap.has(dependency.project_id),
    );

    if (conflictingMod) {
      report.status = "CONFLICT";
      report.conflictingMods.push(conflictingMod.project_id);
      reports.set(installedMod.id, report);
      continue;
    }

    const queue = update.dependencies.required.map(
      (dependency) => dependency.project_id,
    );
    const visitedDependencies = new Set<string>();

    while (queue.length > 0) {
      const depId = queue.shift();

      if (!depId || visitedDependencies.has(depId)) {
        continue;
      }

      visitedDependencies.add(depId);

      if (!installedMap.has(depId)) {
        report.requiredNewMods.push(depId);
      } else if (depId !== installedMod.id) {
        report.cascadingUpdates.push(depId);
      }
    }

    report.status = getFinalStatus(report);
    reports.set(installedMod.id, report);
  }

  return reports;
}

function getFinalStatus(report: ModAnalysisReport): ModStatusType {
  if (report.requiredNewMods.length > 0) {
    return "MISSING_DEPENDENCY";
  }

  if (report.cascadingUpdates.length > 0) {
    return "CASCADING_REQUIRED";
  }

  return "SAFE_UPDATE";
}
