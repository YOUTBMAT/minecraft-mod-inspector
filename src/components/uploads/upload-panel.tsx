"use client";

import { useState } from "react";

export function UploadPanel() {
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <section className="rounded-2xl border border-dashed border-emerald-700/40 bg-white p-8 shadow-sm">
      <label className="flex cursor-pointer flex-col items-center gap-4 text-center">
        <span className="text-lg font-semibold text-slate-900">Selecione um modpack ZIP</span>
        <span className="text-sm text-slate-500">O processamento será adicionado na próxima etapa.</span>
        <input
          className="block w-full max-w-sm text-sm text-slate-600"
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
        />
      </label>
      {fileName ? <p className="mt-5 text-center text-sm text-emerald-800">Arquivo: {fileName}</p> : null}
    </section>
  );
}
