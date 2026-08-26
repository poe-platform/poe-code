import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { toByteSource, type ByteSource } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createTextProgramCommands, type TextProgramOptions } from "../../../src/commands/text-programs/index.js";

export interface OracleCase {
  readonly args: readonly string[];
  readonly stdin?: string | Uint8Array;
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
  readonly expectedExitCode?: number;
}

export async function makeFileSystem(files: Readonly<Record<string, string | Uint8Array>> = {}): Promise<MemoryFileSystem> {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const [path, contents] of Object.entries(files)) {
    assert(path && !path.startsWith("/") && !path.split("/").includes(".."));
    await fs.mkdir(`/work/${dirname(path)}`, { recursive: true });
    await fs.writeFile(`/work/${path}`, typeof contents === "string" ? Buffer.from(contents) : contents);
  }
  return fs;
}

export async function runVirtual(tool: "sed" | "awk", fixture: OracleCase, options: TextProgramOptions = {}, source?: ByteSource) {
  const fs = await makeFileSystem(fixture.files);
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const definition = createTextProgramCommands(options).find(command => command.name === tool);
  assert(definition, `${tool} must be registered`);
  const result = await definition.execute({
    command: tool, args: fixture.args, cwd: "/work", env: { LC_ALL: "C", LANG: "C", TZ: "UTC" }, fs,
    stdin: source ?? toByteSource(fixture.stdin ?? ""), signal: new AbortController().signal,
    stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
    stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
  });
  const files: Record<string, Buffer> = {};
  const visit = async (relative: string) => {
    for (const entry of await fs.readdir(`/work/${relative}`)) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.type === "directory") await visit(child);
      else files[child] = Buffer.from(await fs.readFile(`/work/${child}`));
    }
  };
  await visit("");
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), files, fs };
}

export async function runNative(tool: "sed" | "awk", fixture: OracleCase) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "virtual-text-oracle-")));
  try {
    for (const [path, contents] of Object.entries(fixture.files ?? {})) {
      assert(path && !path.startsWith("/") && !path.split("/").includes(".."));
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), contents);
    }
    const result = await new Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer }>((resolve, reject) => {
      const script = tool === "sed" ? 'exec /usr/bin/sed "$@"' : 'exec /usr/bin/awk "$@"';
      const child = spawn("/bin/bash", ["--noprofile", "--norc", "-c", script, "text-oracle", ...fixture.args], {
        cwd: root, detached: true,
        env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: root, TMPDIR: root },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const output: Record<"stdout" | "stderr", Buffer[]> = { stdout: [], stderr: [] };
      let failure: Error | undefined;
      let size = 0;
      const stop = (error: Error) => {
        failure = error;
        if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch {}
      };
      const timer = setTimeout(() => stop(new Error("native oracle timeout")), 3000);
      for (const stream of ["stdout", "stderr"] as const) child[stream].on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024 * 1024) stop(new Error("native oracle output limit exceeded"));
        else output[stream].push(chunk);
      });
      child.stdin.on("error", error => { if ((error as NodeJS.ErrnoException).code !== "EPIPE") stop(error); });
      child.on("error", error => { failure = error; });
      child.on("close", (exitCode, signal) => {
        clearTimeout(timer);
        if (failure) reject(failure);
        else if (signal || exitCode === null) reject(new Error("native oracle terminated abnormally"));
        else resolve({ exitCode, stdout: Buffer.concat(output.stdout), stderr: Buffer.concat(output.stderr) });
      });
      child.stdin.end(fixture.stdin ?? "");
    });
    const files: Record<string, Buffer> = {};
    const visit = async (relative: string) => {
      for (const name of await readdir(join(root, relative))) {
        const child = relative ? `${relative}/${name}` : name;
        const stat = await lstat(join(root, child));
        assert(!stat.isSymbolicLink());
        if (stat.isDirectory()) await visit(child);
        else { assert(stat.isFile() && stat.size < 1024 * 1024); files[child] = await readFile(join(root, child)); }
      }
    };
    await visit("");
    return { ...result, files };
  } finally { await rm(root, { recursive: true, force: true }); }
}

export async function compareNative(tool: "sed" | "awk", fixture: OracleCase): Promise<void> {
  const expected = await runNative(tool, fixture);
  assert.equal(expected.exitCode, fixture.expectedExitCode ?? 0, `native fixture must have its expected status: ${expected.stderr.toString()}`);
  const actual = await runVirtual(tool, fixture);
  assert.equal(actual.exitCode, expected.exitCode, actual.stderr.toString());
  assert.deepEqual(actual.stdout, expected.stdout, `stdout mismatch: ${JSON.stringify(fixture)}`);
  assert.deepEqual(actual.stderr, expected.stderr);
  assert.deepEqual(actual.files, expected.files);
}

export async function* byteChunks(text: string): ByteSource {
  for (const byte of Buffer.from(text)) yield Uint8Array.of(byte);
}
