'use client';

import { useState } from "react";
import type { IncompatibleModEntry } from "@/lib/modpack/incompatible-mods-db";

interface IncompatibilityAlertCardProps {
  entry: IncompatibleModEntry;
  modName: string;
  onUserDecision?: (keepMod: boolean) => void;
}

export function IncompatibilityAlertCard({
  entry,
  modName,
  onUserDecision,
}: IncompatibilityAlertCardProps) {
  const [keepMod, setKeepMod] = useState(false);

  const handleToggle = (choice: boolean) => {
    setKeepMod(choice);
    onUserDecision?.(choice);
  };

  return (
    <div className={`mt-3 rounded-lg border p-3 ${keepMod ? "border-slate-300 bg-slate-50" : "border-red-200 bg-red-50"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${entry.severity === "CRITICAL" ? "bg-red-600 text-white" : "bg-amber-500 text-white"}`}>
              {entry.severity === "CRITICAL" ? "ALERTA CRÍTICO" : "ATENÇÃO"}
            </span>
            <h4 className="font-semibold text-slate-800">{modName}</h4>
          </div>
          <p className="mt-1 text-xs text-slate-600">{entry.reason}</p>
          <p className="mt-1 text-xs italic text-slate-500">Recomendação: {entry.recommendation}</p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          <span className="text-[11px] font-medium text-slate-500">Manter no pack?</span>
          <div className="inline-flex" role="group">
            <button
              className={`rounded-l-md border px-2.5 py-1 text-xs font-medium ${!keepMod ? "border-red-600 bg-red-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
              type="button"
              onClick={() => handleToggle(false)}
            >
              Remover
            </button>
            <button
              className={`rounded-r-md border-b border-r border-t px-2.5 py-1 text-xs font-medium ${keepMod ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
              type="button"
              onClick={() => handleToggle(true)}
            >
              Ignorar e manter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
