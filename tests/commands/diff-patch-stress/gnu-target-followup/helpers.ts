import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FileSystem } from "../../../../src/contracts/index.js";
import { oracleIdentity, withNativeScratch } from "../gnu-target/oracle.js";
import { cwd, instrument, invoke, memory } from "../safety/helpers.js";

export const owned = fileURLToPath(new URL("./", import.meta.url));
export const sentinel = "followup sentinel: unchanged\n";
export interface NamespaceEntry { path: string; type: string; hex?: string; link?: string }
export interface Probe { id: string; args: readonly string[]; input: string; files: Readonly<Record<string, string>> }
export const sha256 = (text: string | Uint8Array): string => createHash("sha256").update(text).digest("hex");

export async function nativeNamespace(root: string): Promise<NamespaceEntry[]> {
  const entries: NamespaceEntry[] = [];
  async function visit(relative: string): Promise<void> {
    const path = join(root, relative);
    const stat = await lstat(path);
    const entry: NamespaceEntry = { path: relative ? `/${relative}` : "/", type: stat.isDirectory() ? "directory" : stat.isSymbolicLink() ? "symlink" : "file" };
    if (stat.isSymbolicLink()) entry.link = await readlink(path);
    else if (stat.isFile()) entry.hex = (await readFile(path)).toString("hex");
    entries.push(entry);
    if (stat.isDirectory()) for (const name of (await readdir(path)).sort()) await visit(relative ? `${relative}/${name}` : name);
  }
  await visit("");
  return entries;
}

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

export async function nativeProbe(probe: Probe) {
  const identity = oracleIdentity("patch");
  const directory = await mkdtemp(join(owned, ".native-"));
  try {
    await mkdir(join(directory, cwd), { recursive: true });
    for (const [path, data] of Object.entries({ "/sentinel": sentinel, ...probe.files })) {
      assert(path.startsWith("/") && !path.split("/").includes(".."));
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), data);
    }
    const before = await nativeNamespace(directory);
    const result = withNativeScratch(temporary => spawnSync(identity.path, [...probe.args], {
      cwd: join(directory, cwd), input: probe.input, encoding: "utf8", shell: false,
      timeout: 3000, killSignal: "SIGKILL", maxBuffer: 1_048_576,
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC", TMPDIR: temporary },
    }));
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.notEqual(result.status, null);
    assert.equal(await readFile(join(directory, "sentinel"), "utf8"), sentinel);
    return { exitCode: result.status!, stdout: result.stdout, stderr: result.stderr, before, after: await nativeNamespace(directory) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
