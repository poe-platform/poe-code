import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import type { FileSystem } from "../../../../src/contracts/index.js";
import { instrument, invoke, memory } from "../safety/helpers.js";
export const sentinel = "followup sentinel: unchanged\n";
export interface NamespaceEntry { path: string; type: string; hex?: string; link?: string }
export interface Probe { id: string; args: readonly string[]; input: string; files: Readonly<Record<string, string>> }
export const sha256 = (text: string | Uint8Array): string => createHash("sha256").update(text).digest("hex");

export async function virtualNamespace(fs: FileSystem): Promise<NamespaceEntry[]> {
  const entries: NamespaceEntry[] = [];
  async function visit(path: string): Promise<void> {
    const stat = await fs.lstat(path);
    const entry: NamespaceEntry = { path, type: stat.type };
    if (stat.type === "symlink") {
      assert(fs.readlink, "full namespace inspection requires readlink for symlinks");
      entry.link = await fs.readlink(path);
    }
    else if (stat.type === "file") entry.hex = Buffer.from(await fs.readFile(path)).toString("hex");
    entries.push(entry);
    if (stat.type === "directory") for (const name of (await fs.readdir(path)).map(item => item.name).sort()) await visit(`${path === "/" ? "" : path}/${name}`);
  }
  await visit("/");
  return entries;
}

export async function virtualProbe(probe: Probe, args = probe.args) {
  const backing = await memory({});
  for (const [path, data] of Object.entries({ "/sentinel": sentinel, ...probe.files })) {
    await backing.mkdir(dirname(path), { recursive: true });
    await backing.writeFile(path, Buffer.from(data));
  }
  const before = await virtualNamespace(backing);
  const observed = instrument(backing);
  const result = await invoke(observed.fs, "patch", { args, input: probe.input });
  return { ...result, before, after: await virtualNamespace(backing), mutations: observed.mutations() };
}
