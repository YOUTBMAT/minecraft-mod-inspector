import type { ModpackInspectionResult } from "@/types/api";

interface InspectionSummaryProps {
  result: ModpackInspectionResult;
}

export function InspectionSummary({ result }: InspectionSummaryProps) {
  return (
    <section aria-label="Resumo da inspeção" className="grid gap-4 sm:grid-cols-3">
      <SummaryItem label="Mods encontrados" value={result.mods.length} />
      <SummaryItem label="Avisos" value={result.warnings.length} />
      <SummaryItem label="Erros" value={result.errors.length} />
    </section>
  );
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
