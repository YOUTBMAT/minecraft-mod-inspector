"use client";

import { useState } from "react";
import { Dashboard } from "@/components/Dashboard";
import { FileUploader } from "@/components/FileUploader";
import { exportUpdatedModpack } from "@/lib/modpackExporter";
import type {
  CrashAnalysisResult,
  KnownConflictWarning,
  ModAnalysisReport,
  UnifiedModpack,
} from "@/types";

export default function HomePage() {
  const [packInfo, setPackInfo] = useState<UnifiedModpack>();
  const [reports, setReports] = useState<Record<string, ModAnalysisReport>>();
  const [conflicts, setConflicts] = useState<KnownConflictWarning[]>();
  const [crashReport, setCrashReport] = useState<CrashAnalysisResult>();
  const [error, setError] = useState<string>();

  const handlePackAnalyzed = (data: {
    packInfo: UnifiedModpack;
    reports: Record<string, ModAnalysisReport>;
    conflicts?: KnownConflictWarning[];
  }) => {
    setPackInfo(data.packInfo);
    setReports(data.reports);
    setConflicts(data.conflicts);
    setCrashReport(undefined);
    setError(undefined);
  };

  const handleLogAnalyzed = (data: CrashAnalysisResult) => {
    setCrashReport(data);
    setError(undefined);
  };

  const handleReset = () => {
    setPackInfo(undefined);
    setReports(undefined);
    setConflicts(undefined);
    setCrashReport(undefined);
    setError(undefined);
  };

  const handleExport = () => {
    if (!packInfo || !reports) {
      setError("Analise um modpack antes de exportá-lo.");
      return;
    }

    void exportUpdatedModpack(packInfo, reports).catch((exportError) => {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Não foi possível exportar o modpack atualizado.",
      );
    });
  };

  const hasAnalysis = packInfo !== undefined || crashReport !== undefined;

  return (
    <main className="min-h-screen bg-[var(--background)]">
      {error ? (
        <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            <span>{error}</span>
            <button className="font-semibold hover:text-red-950" type="button" onClick={() => setError(undefined)}>
              Fechar
            </button>
          </div>
        </div>
      ) : null}

      {hasAnalysis ? (
        <Dashboard
          conflicts={conflicts}
          crashReport={crashReport}
          onExport={packInfo && reports ? handleExport : undefined}
          onReset={handleReset}
          packInfo={packInfo}
          reports={reports}
        />
      ) : (
        <section className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-10 px-6 py-16">
          <header className="space-y-3">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">
              Minecraft Mod Inspector
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900">
              Verifique seu modpack antes de jogar.
            </h1>
            <p className="max-w-2xl text-lg text-slate-600">
              Envie um modpack ou arquivo de log para analisar compatibilidade e dependências.
            </p>
          </header>
          <FileUploader
            onError={setError}
            onLogAnalyzed={handleLogAnalyzed}
            onPackAnalyzed={handlePackAnalyzed}
          />
        </section>
      )}
    </main>
  );
}
