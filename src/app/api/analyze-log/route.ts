import { NextResponse } from "next/server";
import { parseCrashReport } from "@/lib/crashLogParser";
import { analyzeCrashLog } from "@/lib/modpack/crash-analyzer";
import { learnIncompatibleMod } from "@/lib/modpack/incompatible-mods-db";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let logContent: string;

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { logText?: unknown };
      if (typeof body.logText !== "string") {
        return NextResponse.json(
          { error: "Texto do log de crash é obrigatório." },
          { status: 400 },
        );
      }

      logContent = body.logText;
    } else if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const fileEntry = formData.get("file");

      if (!fileEntry || typeof fileEntry === "string") {
        return NextResponse.json(
          { error: "O campo 'file' é obrigatório no envio multipart." },
          { status: 400 },
        );
      }

      logContent = await fileEntry.text();
    } else {
      logContent = await request.text();
    }

    if (!logContent.trim()) {
      return NextResponse.json(
        { error: "O conteúdo do log não pode estar vazio." },
        { status: 400 },
      );
    }

    if (contentType.includes("application/json")) {
      const report = analyzeCrashLog(logContent);
      learnFromReport(report);
      return NextResponse.json(report, { status: 200 });
    }

    return NextResponse.json(parseCrashReport(logContent), { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Falha ao analisar o log.",
      },
      { status: 500 },
    );
  }
}

function learnFromReport(report: ReturnType<typeof analyzeCrashLog>): void {
  if (!report.issues.some((issue) => issue.severity === "CRITICAL")) {
    return;
  }

  for (const modId of report.issues.flatMap((issue) => issue.offendingMods)) {
    if (/^(?:mod|recurso|backport|sodium)$/i.test(modId) || modId.length < 3) {
      continue;
    }

    learnIncompatibleMod({
      modId: modId.replace(/\.jar$/i, ""),
      aliases: [modId.replace(/\.jar$/i, "")],
      severity: "CRITICAL",
      reason: report.issues[0].description,
      recommendation: report.issues[0].suggestedAction,
    });
  }
}
