import { NextResponse } from "next/server";
import type { PortTargetFormat } from "@/types";
import { matchModpackToPlatform } from "@/lib/portMatcher";

interface PortRequestBody {
  mods: Array<{ id: string; name?: string }>;
  gameVersion: string;
  loader: string;
  targetFormat: PortTargetFormat;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<PortRequestBody>;

    if (!Array.isArray(body.mods) || body.mods.length === 0) {
      return NextResponse.json(
        { error: "É necessário fornecer a lista de mods a portar." },
        { status: 400 },
      );
    }
    if (!body.gameVersion || !body.loader) {
      return NextResponse.json(
        { error: "gameVersion e loader são obrigatórios." },
        { status: 400 },
      );
    }
    if (body.targetFormat !== "curseforge" && body.targetFormat !== "modrinth") {
      return NextResponse.json(
        { error: "targetFormat deve ser 'curseforge' ou 'modrinth'." },
        { status: 400 },
      );
    }

    const result = await matchModpackToPlatform(
      body.mods,
      body.targetFormat,
      body.gameVersion,
      body.loader,
    );

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Falha ao portar o modpack.",
      },
      { status: 500 },
    );
  }
}
