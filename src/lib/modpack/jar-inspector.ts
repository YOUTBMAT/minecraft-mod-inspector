import JSZip from "jszip";
import type { ModMetadata } from "./types";
import { extractVersionFromFileName } from "./version-comparator";

export async function parseModJar(
  fileBuffer: Buffer,
  fileName: string,
): Promise<ModMetadata | null> {
  try {
    const zip = await JSZip.loadAsync(fileBuffer);
    const tomlFile =
      zip.file("META-INF/neoforge.mods.toml") ?? zip.file("META-INF/mods.toml");

    if (!tomlFile) {
      return null;
    }

    const content = await tomlFile.async("string");
    const modIdMatch = content.match(/modId\s*=\s*["']([^"']+)["']/i);
    const versionMatch = content.match(/version\s*=\s*["']([^"']+)["']/i);
    const displayNameMatch = content.match(/displayName\s*=\s*["']([^"']+)["']/i);
    const dependencies = Array.from(
      content.matchAll(/modId\s*=\s*["']([^"']+)["'][\s\S]{0,300}?mandatory\s*=\s*(true|false)/gi),
    ).map((match) => ({
      modId: match[1],
      mandatory: match[2].toLowerCase() === "true",
    }));

    return {
      modId: modIdMatch?.[1] ?? "unknown",
      version: extractVersionFromFileName(versionMatch?.[1] ?? fileName),
      displayName: displayNameMatch?.[1] ?? fileName,
      dependencies,
      fileName,
    };
  } catch (error) {
    console.error(`Erro ao inspecionar o mod ${fileName}:`, error);
    return null;
  }
}
