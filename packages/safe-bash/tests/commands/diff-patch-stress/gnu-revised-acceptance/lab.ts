import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { instrument, invoke } from "../safety/helpers.js";
import { oracleIdentity } from "../gnu-target/oracle.js";
import type { Fixture } from "./fixtures.js";

export interface Entry {
  readonly path: string;
  readonly type: "file" | "directory" | "symlink";
  readonly mode: number;
  readonly ino: number | undefined;
  readonly dev: number | undefined;
  readonly nlink: number | undefined;
  readonly hex?: string;
  readonly target?: string;
}

async function namespace(root: string | MemoryFileSystem): Promise<Entry[]> {
  const entries: Entry[] = [];
  async function visit(path: string) {
    const stat = typeof root === "string" ? await lstat(join(root, path)) : await root.lstat(path);
    const type = "type" in stat ? stat.type : stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file";
    const entry = { path, type, mode: stat.mode & 0o7777, ino: stat.ino, dev: stat.dev, nlink: stat.nlink };
    if (type === "file") entries.push({ ...entry, hex: Buffer.from(typeof root === "string" ? await readFile(join(root, path)) : await root.readFile(path)).toString("hex") });
    else if (type === "symlink") entries.push({ ...entry, target: typeof root === "string" ? await readlink(join(root, path)) : await root.readlink(path) });
    else {
      entries.push(entry);
      const names = typeof root === "string" ? await readdir(join(root, path)) : (await root.readdir(path)).map(child => child.name);
      for (const name of names.sort()) await visit(`${path === "/" ? "" : path}/${name}`);
    }
  }
  await visit("/");
  return entries;
}

export function semantics(entries: readonly Entry[]) {
  return entries.map(({ path, type, hex, target }) => ({ path, type,
    ...(hex === undefined ? {} : { hex }), ...(target === undefined ? {} : { target }) }));
}

export function nativeCommand(root: string, tool: "diff" | "patch", args: readonly string[], input = "") {
  assert(!args.includes("--atomic"), "The virtual extension must never reach GNU");
  const oracle = oracleIdentity(tool);
  const result = spawnSync(oracle.path, [...args], { cwd: join(root, "work"), input, encoding: "utf8", shell: false,
    timeout: 3000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: root, TMPDIR: root } });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.notEqual(result.status, null);
  return { exitCode: result.status!, stdout: result.stdout, stderr: result.stderr.replaceAll(root, "<ROOT>") };
}

export async function captureNative(fixture: Fixture) {
  const root = await mkdtemp(join(tmpdir(), "safe-bash-diff-revised-native-"));
  try {
    await mkdir(join(root, "work"));
    await writeFile(join(root, "boundary"), "outside sentinel\n");
    for (const [path, text] of Object.entries(fixture.files)) {
      await mkdir(dirname(join(root, "work", path)), { recursive: true });
      await writeFile(join(root, "work", path), text);
    }
    for (const [path, target] of Object.entries(fixture.links)) await symlink(target, join(root, "work", path));
    const before = await namespace(root);
    const args = ["--batch", ...fixture.args];
    const result = nativeCommand(root, "patch", args, fixture.input);
    return { id: fixture.id, args, input: fixture.input, ...result, before, after: await namespace(root) };
  } finally { await rm(root, { recursive: true, force: true }); }
}

export async function captureProduct(fixture: Fixture, atomic: boolean) {
  const backing = new MemoryFileSystem();
  await backing.mkdir("/work");
  await backing.writeFile("/boundary", Buffer.from("outside sentinel\n"));
  for (const [path, text] of Object.entries(fixture.files)) {
    await backing.mkdir(dirname(`/work/${path}`), { recursive: true });
    await backing.writeFile(`/work/${path}`, Buffer.from(text));
  }
  for (const [path, target] of Object.entries(fixture.links)) await backing.symlink(target, `/work/${path}`);
  const before = await namespace(backing);
  const observed = instrument(backing);
  const args = [...(atomic ? ["--atomic"] : []), ...fixture.args];
  const result = await invoke(observed.fs, "patch", { args, input: fixture.input, cwd: "/work", signal: AbortSignal.timeout(3000) });
  return { id: fixture.id, args, input: fixture.input, ...result, before, after: await namespace(backing),
    mutations: observed.mutations().map(({ method, path, destination, flag }) => ({ method, path, destination, flag })) };
}

export function assertUntouched(before: readonly Entry[], after: readonly Entry[], changedPaths: readonly string[]) {
  const unchanged = (entries: readonly Entry[]) => entries.filter(entry => !changedPaths.includes(entry.path));
  assert.deepEqual(unchanged(after), unchanged(before), "Unselected identities, bytes, symlinks, modes and complete namespace must remain unchanged");
}
