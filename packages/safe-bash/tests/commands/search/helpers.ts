import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createSearchCommands, type SearchOptions } from "../../../src/commands/search/index.js";
import { nativeRgEnvironment, requireNativeRg } from "./native-tool.js";

export interface Fixture {
  readonly args: readonly string[];
  readonly stdin?: string | Uint8Array;
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
  readonly directories?: readonly string[];
  readonly links?: Readonly<Record<string, string>>;
  readonly code?: number;
}

function safePath(root: string, relative: string): string {
  assert(relative && !relative.startsWith("/") && !relative.includes("\0"));
  const path = resolve(root, relative);
  assert(path.startsWith(root + sep), `fixture path outside isolated root: ${relative}`);
  return path;
}

export async function makeFileSystem(fixture: Fixture): Promise<MemoryFileSystem> {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const directory of fixture.directories ?? []) await fs.mkdir(safePath("/work", directory), { recursive: true });
  for (const [name, bytes] of Object.entries(fixture.files ?? {})) {
    const path = safePath("/work", name);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, Buffer.from(bytes));
  }
  for (const [name, target] of Object.entries(fixture.links ?? {})) {
    const path = safePath("/work", name);
    safePath("/work", join(dirname(name), target));
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.symlink(target, path);
  }
  return fs;
}

export async function virtual(fixture: Fixture, options: SearchOptions = {}, overrides: Partial<CommandContext> = {}) {
  const fs = await makeFileSystem(fixture);
  const output: Buffer[] = []; const errors: Buffer[] = [];
  const context: CommandContext = {
    command: "rg", args: fixture.args, cwd: "/work", env: { LC_ALL: "C", LANG: "C" }, fs,
    stdin: toByteSource(fixture.stdin ?? ""), stdinIsDefault: fixture.stdin === undefined, signal: new AbortController().signal,
    stdout: { async write(bytes) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes) { errors.push(Buffer.from(bytes)); } }, ...overrides,
  };
  const result = await createSearchCommands(options)[0]!.execute(context);
  for (const [name, bytes] of Object.entries(fixture.files ?? {})) assert.deepEqual(Buffer.from(await fs.readFile(`/work/${name}`)), Buffer.from(bytes), `search changed ${name}`);
  return { code: result.exitCode, stdout: Buffer.concat(output), stderr: Buffer.concat(errors), fs };
}

export async function native(fixture: Fixture) {
  const identity = requireNativeRg();
  const root = await realpath(await mkdtemp(join(tmpdir(), "virtual-rg-native-")));
  try {
    for (const directory of fixture.directories ?? []) await mkdir(safePath(root, directory), { recursive: true });
    for (const [name, bytes] of Object.entries(fixture.files ?? {})) {
      const path = safePath(root, name);
      await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes);
    }
    for (const [name, target] of Object.entries(fixture.links ?? {})) {
      const path = safePath(root, name); safePath(root, join(dirname(name), target));
      await mkdir(dirname(path), { recursive: true }); await symlink(target, path);
    }
    const result = await new Promise<{ code: number; stdout: Buffer; stderr: Buffer }>((resolve, reject) => {
      const child = spawn(identity.path, ["--no-config", "--no-ignore-parent", "--no-ignore-global", "--sort=path", ...fixture.args], {
        cwd: root, env: nativeRgEnvironment(root, identity.path), stdio: ["pipe", "pipe", "pipe"],
      });
      const output: Buffer[] = []; const errors: Buffer[] = [];
      let failure: Error | undefined; let size = 0;
      const stop = (error: Error) => { failure ??= error; child.kill("SIGKILL"); };
      const timer = setTimeout(() => stop(new Error("native rg deadline exceeded")), 3000);
      for (const [stream, chunks] of [[child.stdout, output], [child.stderr, errors]] as const) stream.on("data", (bytes: Buffer) => {
        size += bytes.length;
        if (size > 1024 * 1024) stop(new Error("native rg output limit exceeded")); else chunks.push(bytes);
      });
      child.on("error", error => { failure = error; });
      child.stdin.on("error", error => { if ((error as NodeJS.ErrnoException).code !== "EPIPE") stop(error); });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (failure) reject(failure); else if (signal || code === null) reject(new Error("native rg terminated abnormally"));
        else resolve({ code, stdout: Buffer.concat(output), stderr: Buffer.concat(errors) });
      });
      child.stdin.end(fixture.stdin ?? "");
    });
    for (const [name, bytes] of Object.entries(fixture.files ?? {})) assert.deepEqual(await readFile(safePath(root, name)), Buffer.from(bytes));
    return result;
  } finally { await rm(root, { recursive: true, force: true }); }
}

export function jsonEvents(bytes: Uint8Array): unknown[] {
  return Buffer.from(bytes).toString("utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line, (key, value: unknown) => key === "elapsed" || key === "elapsed_total" ? "nondeterministic native timing" : value));
}

export async function differential(fixture: Fixture): Promise<void> {
  const actual = await virtual(fixture);
  assert.equal(actual.code, fixture.code ?? 0, actual.stderr.toString());
  const expected = await native(fixture);
  assert.equal(expected.code, fixture.code ?? 0, expected.stderr.toString());
  assert.equal(actual.code, expected.code, actual.stderr.toString());
  assert.deepEqual(actual.stderr, expected.stderr);
  if (fixture.args.includes("--json") && actual.stdout[0] === 123 && expected.stdout[0] === 123) assert.deepEqual(jsonEvents(actual.stdout), jsonEvents(expected.stdout));
  else assert.deepEqual(actual.stdout, expected.stdout);
}
