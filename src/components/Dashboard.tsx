"use client";

import { useState } from "react";
import type {
  CrashAnalysisResult,
  KnownConflictWarning,
  ModAnalysisReport,
  ModStatusType,
  PortCandidate,
  PortMatch,
  PortTargetFormat,
  UnifiedModpack,
} from "@/types";
import { exportPortedModpack } from "@/lib/modpackExporter";

interface DashboardProps {
  packInfo?: UnifiedModpack;
  reports?: Record<string, ModAnalysisReport>;
  conflicts?: KnownConflictWarning[];
  crashReport?: CrashAnalysisResult;
  onReset: () => void;
  onExport?: () => void;
}

type StatusFilter = "ALL" | ModStatusType;

const statusLabels: Record<ModStatusType, string> = {
  UP_TO_DATE: "Atualizado",
  SAFE_UPDATE: "Seguro p/ Atualizar",
  CASCADING_REQUIRED: "Exige Cascata",
  MISSING_DEPENDENCY: "Falta Dependência",
  CONFLICT: "Conflito Detectado",
};

const statusStyles: Record<ModStatusType, string> = {
  UP_TO_DATE: "bg-slate-100 text-slate-700 ring-slate-200",
  SAFE_UPDATE: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  CASCADING_REQUIRED: "bg-blue-100 text-blue-800 ring-blue-200",
  MISSING_DEPENDENCY: "bg-orange-100 text-orange-800 ring-orange-200",
  CONFLICT: "bg-red-100 text-red-800 ring-red-200",
};

export function Dashboard({
  packInfo,
  reports = {},
  conflicts = [],
  crashReport,
  onReset,
  onExport,
}: DashboardProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [expandedModId, setExpandedModId] = useState<string | null>(null);
  const [portTargetFormat, setPortTargetFormat] = useState<PortTargetFormat | null>(null);
  const [portMatches, setPortMatches] = useState<PortMatch[] | null>(null);
  const [portLoading, setPortLoading] = useState(false);
  const [portError, setPortError] = useState<string | null>(null);
  const [portRequiresApiKey, setPortRequiresApiKey] = useState(false);
  const [portSelections, setPortSelections] = useState<Record<string, number | "exclude">>({});

  const handlePortStart = async (targetFormat: PortTargetFormat) => {
    if (!packInfo) {
      return;
    }

    setPortTargetFormat(targetFormat);
    setPortLoading(true);
    setPortError(null);
    setPortMatches(null);
    setPortRequiresApiKey(false);

    try {
      const response = await fetch("/api/port-modpack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mods: packInfo.mods.map((mod) => ({ id: mod.id, name: mod.name })),
          gameVersion: packInfo.gameVersion,
          loader: packInfo.loader,
          targetFormat,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error ?? "Não foi possível portar o modpack.");
      }

      const matches: PortMatch[] = data.matches;
      setPortMatches(matches);
      setPortRequiresApiKey(Boolean(data.requiresCurseForgeApiKey));
      setPortSelections(
        Object.fromEntries(
          matches.map((match) => [
            match.sourceModId,
            match.status === "matched" ? 0 : "exclude",
          ]),
        ),
      );
    } catch (error) {
      setPortError(
        error instanceof Error ? error.message : "Não foi possível portar o modpack.",
      );
    } finally {
      setPortLoading(false);
    }
  };

  const handlePortCancel = () => {
    setPortMatches(null);
    setPortTargetFormat(null);
    setPortError(null);
    setPortRequiresApiKey(false);
    setPortSelections({});
  };

  const handlePortConfirm = () => {
    if (!packInfo || !portTargetFormat || !portMatches) {
      return;
    }

    const confirmedCandidates: PortCandidate[] = portMatches
      .map((match) => {
        const selection = portSelections[match.sourceModId];
        if (selection === "exclude" || selection === undefined) {
          return null;
        }
        return match.candidates[selection] ?? null;
      })
      .filter((candidate): candidate is PortCandidate => candidate !== null);

    void exportPortedModpack(
      {
        name: packInfo.name,
        gameVersion: packInfo.gameVersion,
        loader: packInfo.loader,
        loaderVersion: packInfo.loaderVersion,
      },
      portTargetFormat,
      confirmedCandidates,
    ).catch((error) => {
      setPortError(
        error instanceof Error ? error.message : "Não foi possível exportar o pack portado.",
      );
    });
  };

  const rows = packInfo
    ? packInfo.mods.map((mod) => ({
        installedVersion:
          mod.version ?? (mod.fileId === undefined ? "Não identificada" : String(mod.fileId)),
        report: reports[mod.id] ?? createFallbackReport(mod.id),
      }))
    : Object.values(reports).map((report) => ({
        installedVersion: "Não identificada",
        report,
      }));

  const normalizedSearch = search.trim().toLowerCase();
  const filteredRows = rows.filter(({ report }) => {
    const matchesSearch = `${report.modName ?? ""} ${report.modId}`
      .toLowerCase()
      .includes(normalizedSearch);
    const matchesStatus = statusFilter === "ALL" || report.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const reportValues = Object.values(reports);
  const totalMods = packInfo?.mods.length ?? reportValues.length;
  const safeUpdates = reportValues.filter(
    (report) => report.status === "SAFE_UPDATE",
  ).length;
  const conflictCount = reportValues.filter(
    (report) => report.status === "CONFLICT",
  ).length;
  const cascadingUpdates = reportValues.filter(
    (report) => report.status === "CASCADING_REQUIRED",
  ).length;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Resultado da inspeção
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
              {packInfo?.name ?? "Análise de modpack"}
            </h1>
            {packInfo ? (
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                <span> Minecraft {packInfo.gameVersion}</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800">
                  <LoaderIcon />
                  {packInfo.loader} {packInfo.loaderVersion}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                  {packInfo.format}
                </span>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-emerald-600 hover:text-emerald-700"
              type="button"
              onClick={onReset}
            >
              Analisar Outro Arquivo
            </button>
            <button
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={onExport}
              disabled={!onExport}
            >
              Exportar Pack Atualizado
            </button>
            {packInfo ? (
              <button
                className="rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-800 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() =>
                  handlePortStart(packInfo.format === "modrinth" ? "curseforge" : "modrinth")
                }
                disabled={portLoading}
              >
                {portLoading
                  ? "A procurar correspondências..."
                  : `Portar para ${packInfo.format === "modrinth" ? "CurseForge" : "Modrinth"}`}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard label="Total de mods" value={totalMods} />
          <SummaryCard label="Podem atualizar" value={safeUpdates} tone="green" />
          <SummaryCard label="Conflitos" value={conflictCount} tone="red" />
          <SummaryCard label="Exigem cascata" value={cascadingUpdates} tone="blue" />
        </div>
      </header>

      {crashReport ? <CrashReportCard report={crashReport} /> : null}

      {conflicts.length > 0 ? <KnownConflictsCard conflicts={conflicts} /> : null}

      {portError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {portError}
        </div>
      ) : null}

      {portRequiresApiKey ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Portar para CurseForge requer a variável de ambiente <code>CURSEFORGE_API_KEY</code> configurada no servidor.
        </div>
      ) : null}

      {portMatches && portTargetFormat ? (
        <PortReviewPanel
          matches={portMatches}
          targetFormat={portTargetFormat}
          selections={portSelections}
          onSelectionChange={(sourceModId, value) =>
            setPortSelections((previous) => ({ ...previous, [sourceModId]: value }))
          }
          onCancel={handlePortCancel}
          onConfirm={handlePortConfirm}
        />
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Mods analisados</h2>
            <p className="mt-1 text-sm text-slate-500">
              {filteredRows.length} de {rows.length} mods exibidos
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <label className="relative block sm:min-w-64">
              <span className="sr-only">Buscar por ID do mod</span>
              <SearchIcon />
              <input
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                placeholder="Buscar por ID..."
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label>
              <span className="sr-only">Filtrar por status</span>
              <select
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 sm:w-52"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                <option value="ALL">Todos</option>
                <option value="SAFE_UPDATE">Atualizações disponíveis</option>
                <option value="CASCADING_REQUIRED">Cascata</option>
                <option value="CONFLICT">Conflitos</option>
                <option value="MISSING_DEPENDENCY">Faltando dep.</option>
              </select>
            </label>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Mod</th>
                <th className="px-5 py-3 font-semibold">Versão instalada</th>
                <th className="px-5 py-3 font-semibold">Versão mais recente</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3"><span className="sr-only">Detalhes</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.map(({ installedVersion, report }) => {
                const canExpand = isExpandable(report.status);
                const isExpanded = expandedModId === report.modId;

                return (
                  <ModTableRows
                    key={report.modId}
                    installedVersion={installedVersion}
                    report={report}
                    canExpand={canExpand}
                    isExpanded={isExpanded}
                    onToggle={() => setExpandedModId(isExpanded ? null : report.modId)}
                  />
                );
              })}
              {filteredRows.length === 0 ? (
                <tr>
                  <td className="px-5 py-12 text-center text-slate-500" colSpan={5}>
                    Nenhum mod corresponde aos filtros atuais.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function ModTableRows({
  installedVersion,
  report,
  canExpand,
  isExpanded,
  onToggle,
}: {
  installedVersion: string;
  report: ModAnalysisReport;
  canExpand: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const detailItems = getDetailItems(report);

  return (
    <>
      <tr
        className={`transition-colors ${canExpand ? "cursor-pointer hover:bg-slate-50" : ""}`}
        onClick={canExpand ? onToggle : undefined}
      >
        <td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-900">
          <span>{report.modName ?? report.modId}</span>
          {report.modName ? <span className="ml-2 text-xs font-normal text-slate-400">#{report.modId}</span> : null}
        </td>
        <td className="whitespace-nowrap px-5 py-4 text-slate-600">{installedVersion}</td>
        <td className="whitespace-nowrap px-5 py-4 text-slate-600">{report.latestVersion}</td>
        <td className="px-5 py-4"><StatusBadge status={report.status} /></td>
        <td className="px-5 py-4 text-right">
          {canExpand ? (
            <button
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? "Recolher" : "Expandir"} detalhes de ${report.modId}`}
              className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggle();
              }}
            >
              <ChevronIcon expanded={isExpanded} />
            </button>
          ) : null}
        </td>
      </tr>
      {canExpand && isExpanded ? (
        <tr className="bg-slate-50/70">
          <td className="px-5 pb-5 pt-1" colSpan={5}>
            <div className="rounded-lg border border-slate-200 bg-white p-4 transition-all">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Detalhes da análise</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                {detailItems.map(({ label, items }) => (
                  <div key={label}>
                    <p className="text-sm font-semibold text-slate-800">{label}</p>
                    {items.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-sm text-slate-600">
                        {items.map((item) => <li key={item}>• {item}</li>)}
                      </ul>
                    ) : <p className="mt-2 text-sm text-slate-400">Nenhum</p>}
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function CrashReportCard({ report }: { report: CrashAnalysisResult }) {
  const isWarning = report.type === "MISSING_DEPENDENCY";
  const colorClasses = isWarning
    ? "border-orange-200 bg-orange-50 text-orange-950"
    : "border-red-200 bg-red-50 text-red-950";

  return (
    <section className={`rounded-2xl border p-6 shadow-sm ${colorClasses}`}>
      <div className="flex gap-4">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/70">
          <AlertIcon />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-bold">{report.title}</h2>
            <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
              {report.type.replaceAll("_", " ")}
            </span>
          </div>
          {report.suspectedMod ? (
            <p className="mt-3 text-sm">
              Mod suspeito: <span className="rounded-md bg-white/70 px-2 py-1 font-semibold">{report.suspectedMod}</span>
            </p>
          ) : null}
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-lg bg-white/60 p-4">
              <p className="text-xs font-bold uppercase tracking-wide opacity-70">Detalhes técnicos</p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{report.details}</p>
            </div>
            <div className="rounded-lg bg-white/80 p-4">
              <p className="text-xs font-bold uppercase tracking-wide opacity-70">Solução recomendada</p>
              <p className="mt-2 text-sm font-medium">{report.recommendation}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function KnownConflictsCard({ conflicts }: { conflicts: KnownConflictWarning[] }) {
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm">
      <div className="flex gap-4">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/70">
          <AlertIcon />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">Possíveis conflitos entre mods</h2>
          <p className="mt-1 text-sm opacity-80">
            Combinações de mods conhecidas por causar problemas, com base numa lista selecionada (não exaustiva).
          </p>
          <ul className="mt-4 space-y-3">
            {conflicts.map((conflict) => (
              <li
                key={`${conflict.ruleId}-${conflict.modAId}-${conflict.modBId}`}
                className="rounded-lg bg-white/70 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {conflict.modAName ?? conflict.modAId}
                  </span>
                  <span className="text-amber-700">×</span>
                  <span className="font-semibold">
                    {conflict.modBName ?? conflict.modBId}
                  </span>
                  <span
                    className={`ml-2 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                      conflict.severity === "critical"
                        ? "bg-red-100 text-red-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {conflict.severity === "critical" ? "Crítico" : "Aviso"}
                  </span>
                </div>
                <p className="mt-2 text-sm">{conflict.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

const portStatusLabels: Record<PortMatch["status"], string> = {
  matched: "Correspondência encontrada",
  ambiguous: "Múltiplas opções — escolha uma",
  unmatched: "Nenhuma correspondência",
};

const portStatusStyles: Record<PortMatch["status"], string> = {
  matched: "bg-emerald-100 text-emerald-800",
  ambiguous: "bg-amber-100 text-amber-800",
  unmatched: "bg-slate-200 text-slate-700",
};

const portConfidenceLabels: Record<PortCandidate["confidence"], string> = {
  high: "Alta confiança",
  medium: "Confiança média",
  low: "Baixa confiança — verifique",
};

function PortReviewPanel({
  matches,
  targetFormat,
  selections,
  onSelectionChange,
  onCancel,
  onConfirm,
}: {
  matches: PortMatch[];
  targetFormat: PortTargetFormat;
  selections: Record<string, number | "exclude">;
  onSelectionChange: (sourceModId: string, value: number | "exclude") => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const includedCount = Object.values(selections).filter((value) => value !== "exclude").length;

  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-indigo-950">
            Rever portagem para {targetFormat === "curseforge" ? "CurseForge" : "Modrinth"}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-indigo-900/80">
            As correspondências são encontradas por pesquisa de nome — não existe um mapeamento
            oficial de IDs entre CurseForge e Modrinth. Confirme ou corrija cada mod antes de
            exportar; nada é incluído automaticamente sem confiança alta.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-lg border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-100"
            type="button"
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={onConfirm}
            disabled={includedCount === 0}
          >
            Confirmar e exportar ({includedCount})
          </button>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-indigo-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-indigo-100 bg-indigo-50/60 text-xs uppercase tracking-wide text-indigo-900">
            <tr>
              <th className="px-4 py-3 font-semibold">Mod original</th>
              <th className="px-4 py-3 font-semibold">Correspondência escolhida</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {matches.map((match) => {
              const selection = selections[match.sourceModId] ?? "exclude";
              return (
                <tr key={match.sourceModId}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {match.sourceModName ?? match.sourceModId}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="w-full max-w-sm rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100"
                      value={selection}
                      onChange={(event) =>
                        onSelectionChange(
                          match.sourceModId,
                          event.target.value === "exclude" ? "exclude" : Number(event.target.value),
                        )
                      }
                    >
                      <option value="exclude">Não incluir</option>
                      {match.candidates.map((candidate, index) => (
                        <option key={candidate.targetId} value={index}>
                          {candidate.targetName} — {portConfidenceLabels[candidate.confidence]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${portStatusStyles[match.status]}`}
                    >
                      {portStatusLabels[match.status]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "green" | "red" | "blue";
}) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-900",
    red: "border-red-200 bg-red-50 text-red-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
  };

  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <p className="text-sm opacity-75">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: ModStatusType }) {
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${statusStyles[status]}`}>
      {statusLabels[status]}
    </span>
  );
}

function isExpandable(status: ModStatusType) {
  return status === "CASCADING_REQUIRED" || status === "MISSING_DEPENDENCY" || status === "CONFLICT";
}

function getDetailItems(report: ModAnalysisReport) {
  return [
    { label: "Atualizados junto", items: report.cascadingUpdates },
    { label: "Novos exigidos", items: report.requiredNewMods },
    { label: "Mods conflitantes", items: report.conflictingMods },
  ];
}

function createFallbackReport(modId: string): ModAnalysisReport {
  return {
    modId,
    status: "UP_TO_DATE",
    latestVersion: "Não identificada",
    requiredNewMods: [],
    cascadingUpdates: [],
    conflictingMods: [],
  };
}

function LoaderIcon() {
  return <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-600" />;
}

function SearchIcon() {
  return <span aria-hidden="true" className="absolute left-3 top-2.5 text-slate-400">⌕</span>;
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return <span aria-hidden="true" className={`block transition-transform ${expanded ? "rotate-180" : ""}`}>⌄</span>;
}

function AlertIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 8v4m0 4h.01M10.3 3.6 2.9 17a2 2 0 0 0 1.75 3h14.7a2 2 0 0 0 1.75-3L13.7 3.6a2 2 0 0 0-3.5 0Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}
