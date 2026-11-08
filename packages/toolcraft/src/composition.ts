import { readFile } from "node:fs/promises";

export interface ToolcraftCompositionPackage {
  name: string;
  version: string;
  license: string;
}

export interface ToolcraftComposition {
  schemaVersion: 1;
  packages: ToolcraftCompositionPackage[];
}

/**
 * Loads Toolcraft's deterministic bundled-package inventory without inspecting source maps.
 * The manifest includes Toolcraft and every package nested inside its published tarball with exact
 * versions and licenses. Incompatible manifest shape changes increment `schemaVersion`.
 */
export async function loadToolcraftComposition(): Promise<ToolcraftComposition> {
  const manifestUrl = new URL("./composition.json", import.meta.url);
  return JSON.parse(await readFile(manifestUrl, "utf8")) as ToolcraftComposition;
}
