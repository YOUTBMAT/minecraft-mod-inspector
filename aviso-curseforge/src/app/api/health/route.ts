import { NextResponse } from "next/server";
import { getCurseForgeKeyState } from "@/lib/curseforgeService";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "minecraft-mod-inspector",
    // Nunca expõe o valor da chave: só se ela existe e se tem o formato esperado.
    curseforgeKey: getCurseForgeKeyState(),
  });
}
