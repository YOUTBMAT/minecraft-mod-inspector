'use client';

import { useState } from "react";
import type { CommunityReport } from "@/lib/modpack/community-search";

interface CommunityReportsDrawerProps {
  modName: string;
  errorSnippet?: string;
}

export function CommunityReportsDrawer({
  modName,
  errorSnippet,
}: CommunityReportsDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [reports, setReports] = useState<CommunityReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchReports = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/search-community-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modName,
          errorText: errorSnippet || "crash",
        }),
      });

      if (!response.ok) {
        throw new Error("Falha ao carregar relatos");
      }

      const data = (await response.json()) as { reports?: CommunityReport[] };
      setReports(Array.isArray(data.reports) ? data.reports : []);
    } catch {
      setError("Não foi possível buscar relatos da comunidade no momento.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2 text-xs" onClick={(event) => event.stopPropagation()}>
      {!reports && !loading ? (
        <button
          aria-label={`Buscar relatos da comunidade sobre ${modName}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-100 px-2.5 py-1 text-slate-600 transition-colors hover:bg-slate-200"
          type="button"
          onClick={() => void fetchReports()}
        >
          <span aria-hidden="true">⌕</span>
          Buscar relatos da comunidade
        </button>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 py-1 text-slate-500">
          <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
          Pesquisando no GitHub Issues e Reddit...
        </div>
      ) : null}

      {error ? <p className="text-red-500">{error}</p> : null}

      {reports && reports.length === 0 ? (
        <p className="italic text-slate-400">Nenhum relato recente encontrado para este mod.</p>
      ) : null}

      {reports && reports.length > 0 ? (
        <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between font-semibold text-slate-700">
            <span>Relatos encontrados ({reports.length})</span>
            <button
              className="rounded px-1 text-slate-400 hover:text-slate-600"
              type="button"
              onClick={() => setReports(null)}
            >
              Fechar
            </button>
          </div>
          <div className="divide-y divide-slate-200">
            {reports.map((report, index) => (
              <div key={`${report.source}-${report.url}-${index}`} className="py-2 first:pt-0 last:pb-0">
                <div className="mb-1 flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${report.source === "GitHub" ? "bg-purple-100 text-purple-700" : "bg-orange-100 text-orange-700"}`}>
                    {report.source}
                  </span>
                  {report.isConfirmedFix ? (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                      Resolvido / Correção
                    </span>
                  ) : null}
                  <a
                    className="max-w-md truncate font-medium text-blue-600 hover:underline"
                    href={report.url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {report.title}
                  </a>
                </div>
                <p className="line-clamp-2 text-slate-500">{report.snippet}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
