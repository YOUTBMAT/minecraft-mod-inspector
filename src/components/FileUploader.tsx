"use client";

import React, { useCallback, useState } from "react";
import type {
  CrashAnalysisResult,
  KnownConflictWarning,
  ModAnalysisReport,
  UnifiedModpack,
} from "@/types";

interface PackAnalysisData {
  packInfo: UnifiedModpack;
  reports: Record<string, ModAnalysisReport>;
  conflicts?: KnownConflictWarning[];
}

interface FileUploaderProps {
  onPackAnalyzed: (data: PackAnalysisData) => void;
  onLogAnalyzed: (data: CrashAnalysisResult) => void;
  onError: (message: string) => void;
}

const acceptedExtensions = ["zip", "mrpack", "json", "txt", "log"];

export function FileUploader({
  onPackAnalyzed,
  onLogAnalyzed,
  onError,
}: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);

  const processFile = useCallback(
    async (file: File) => {
      const extension = file.name.split(".").pop()?.toLowerCase();

      if (!extension || !acceptedExtensions.includes(extension)) {
        onError("Formato não suportado. Envie um ZIP, MRPACK, JSON, TXT ou LOG.");
        return;
      }

      const isLog = extension === "txt" || extension === "log";
      const endpoint = isLog ? "/api/analyze-log" : "/api/analyze-pack";
      const formData = new FormData();
      formData.append("file", file);

      setFileName(file.name);
      setIsLoading(true);
      setLoadingMessage(
        isLog
          ? "Analisando arquivo de crash log..."
          : "Processando modpack e consultando dependências...",
      );

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          body: formData,
        });
        const data: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            getErrorMessage(data) ??
              `Não foi possível analisar o arquivo (${response.status}).`,
          );
        }

        if (isLog) {
          onLogAnalyzed(data as CrashAnalysisResult);
        } else {
          onPackAnalyzed(data as PackAnalysisData);
        }
      } catch (error) {
        onError(
          error instanceof Error
            ? error.message
            : "Ocorreu um erro ao enviar o arquivo para análise.",
        );
      } finally {
        setIsLoading(false);
        setLoadingMessage("");
      }
    },
    [onError, onLogAnalyzed, onPackAnalyzed],
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (file) {
        void processFile(file);
      }
    },
    [processFile],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setIsDragging(false);

      const file = event.dataTransfer.files[0];
      if (file) {
        void processFile(file);
      }
    },
    [processFile],
  );

  return (
    <section className="w-full">
      <label
        className={`flex min-h-64 cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed bg-white p-8 text-center shadow-sm transition-colors duration-200 focus-within:border-emerald-600 hover:border-emerald-600 ${
          isDragging
            ? "border-emerald-600 bg-emerald-50 ring-4 ring-emerald-100"
            : "border-slate-300"
        } ${isLoading ? "pointer-events-none opacity-70" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setIsDragging(false);
        }}
        onDrop={handleDrop}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <UploadIcon />
        </span>
        <span className="text-lg font-semibold text-slate-900">
          {isDragging ? "Solte o arquivo aqui" : "Envie um arquivo para análise"}
        </span>
        <span className="max-w-md text-sm text-slate-500">
          Arraste e solte ou selecione um modpack ou arquivo de log.
        </span>
        <span className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-800">
          Selecionar arquivo
        </span>
        <input
          className="sr-only"
          type="file"
          accept=".zip,.mrpack,.json,.txt,.log"
          onChange={handleInputChange}
          disabled={isLoading}
        />
      </label>

      {isLoading ? (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm text-emerald-800" role="status" aria-live="polite">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-700" />
          <span>{loadingMessage}</span>
        </div>
      ) : fileName ? (
        <p className="mt-4 text-center text-sm text-slate-600">
          Arquivo selecionado: <span className="font-medium text-slate-900">{fileName}</span>
        </p>
      ) : null}
    </section>
  );
}

function UploadIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="28"
      viewBox="0 0 24 24"
      width="28"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function getErrorMessage(value: unknown): string | undefined {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }

  return undefined;
}
