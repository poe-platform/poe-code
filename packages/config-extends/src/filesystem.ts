import type { ResolveOptions } from "./types.js";

export async function readTextFile(fs: ResolveOptions["fs"], path: string): Promise<string> {
  return "capabilities" in fs
    ? new TextDecoder().decode(await fs.readFile(path))
    : fs.readFile(path, "utf8");
}
