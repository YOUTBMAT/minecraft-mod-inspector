import { NextResponse } from "next/server";
import { searchCommunityReports } from "@/lib/modpack/community-search";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      modName?: unknown;
      errorText?: unknown;
    };

    if (typeof body.modName !== "string" || !body.modName.trim()) {
      return NextResponse.json(
        { error: "Nome do mod é obrigatório para realizar a busca." },
        { status: 400 },
      );
    }

    const errorText = typeof body.errorText === "string"
      ? body.errorText
      : undefined;
    const result = await searchCommunityReports(body.modName, errorText);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[search-community-reports] Falha ao buscar relatos", error);
    return NextResponse.json(
      { error: "Falha ao buscar relatos da comunidade." },
      { status: 500 },
    );
  }
}
