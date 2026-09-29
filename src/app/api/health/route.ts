import { NextResponse } from "next/server";
import { getCurseForgeKeyState, probeCurseForgeApi } from "@/lib/curseforgeService";

export async function GET(request: Request) {
  const body: Record<string, unknown> = {
    status: "ok",
    service: "minecraft-mod-inspector",
    // Nunca expõe o valor da chave: só se ela existe e se tem o formato esperado.
    curseforgeKey: getCurseForgeKeyState(),
  };

  // /api/health?check=curseforge -> testa a API do CurseForge de verdade.
  if (new URL(request.url).searchParams.get("check") === "curseforge") {
    body.curseforgeApi = await probeCurseForgeApi();
  }

  return NextResponse.json(body);
}
