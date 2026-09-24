import { NextResponse } from "next/server";
import { parseCrashReport } from "@/lib/crashLogParser";
import { analyzeCrashLog } from "@/lib/modpack/crash-analyzer";

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
      return NextResponse.json(analyzeCrashLog(logContent), { status: 200 });
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
