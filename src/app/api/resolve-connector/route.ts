import { NextResponse } from "next/server";
import { resolveCurseForgeModsBySlug } from "@/lib/curseforgeService";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      gameVersion?: string;
      loader?: string;
    };

    if (!body.gameVersion || !body.loader) {
      return NextResponse.json(
        { error: "gameVersion e loader são obrigatórios." },
        { status: 400 },
      );
    }

    const resolved = await resolveCurseForgeModsBySlug(
      ["sinytra-connector"],
      body.gameVersion,
      body.loader,
    );
    const connector = Array.from(resolved.values()).find(
      (mod) => Number.isSafeInteger(Number(mod.latestFileId)) && Number(mod.latestFileId) > 0,
    );

    if (!connector) {
      return NextResponse.json(
        { error: "Não foi encontrado um arquivo válido do Sinytra Connector." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      projectID: Number(connector.projectId),
      fileID: Number(connector.latestFileId),
      required: true,
      name: "Sinytra Connector",
    });
  } catch (error) {
    console.error("[resolve-connector] Falha ao resolver Sinytra Connector", error);
    return NextResponse.json(
      { error: "Não foi possível resolver o Sinytra Connector." },
      { status: 500 },
    );
  }
}
