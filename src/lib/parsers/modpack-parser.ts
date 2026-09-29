import JSZip from "jszip";

export async function readModpackEntries(file: ArrayBuffer): Promise<string[]> {
  const archive = await JSZip.loadAsync(file);
  return Object.keys(archive.files);
}
