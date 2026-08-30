import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toByteSource, type ByteSink, type ByteSource } from "../../../../src/contracts/index.js";
import { createDiffPatchCommands, type DiffPatchOptions } from "../../../../src/commands/diff-patch/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { oracleIdentity, oraclePath } from "../gnu-target/oracle.js";

export const oraclePaths = {
  get diff() { return oraclePath("diff"); },
  get patch() { return oraclePath("patch"); },
};

export interface Result { exitCode: number; stdout: string; stderr: string }
export type Files = Readonly<Record<string, string>>;

async function processResult(binary: string, args: readonly string[], cwd: string, input: string): Promise<Result> {
  assert(Buffer.byteLength(input) <= 256 * 1024, "native stdin cap");
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [...args], {
      cwd, shell: false, stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: cwd, TMPDIR: cwd, PATCH_GET: "0" },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let failure: Error | undefined;
    const stop = (error: Error) => { failure ??= error; child.kill("SIGKILL"); };
    const timer = setTimeout(() => stop(new Error("native timeout after 3000ms")), 3000);
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]] as const) {
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 512 * 1024) stop(new Error("native combined output cap"));
        else chunks.push(chunk);
      });
    }
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (signal) reject(new Error(`native terminated: ${signal}`));
      else resolve({ exitCode: code ?? 2, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
    child.stdin.on("error", error => {
      if (!("code" in error && error.code === "EPIPE")) stop(error);
    });
    child.stdin.end(input);
  });
}

export async function native(tool: "diff" | "patch", args: readonly string[], files: Files = {}, input = "", apple = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "virtual-bash-formats-")));
  try {
    for (const [name, text] of Object.entries(files)) {
      assert(/^[A-Za-z0-9_. -]+$/u.test(name) && name !== "." && name !== "..");
      assert(Buffer.byteLength(text) <= 256 * 1024, "native file cap");
      await writeFile(join(root, name), text, { flag: "wx" });
    }
    const result = await processResult(oraclePath(tool, apple ? "apple-calibration" : "gnu"), args, root, input);
    let target: string | undefined;
    try {
      assert((await stat(join(root, "target"))).size <= 256 * 1024, "native target read cap");
      target = await readFile(join(root, "target"), "utf8");
    }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    return { ...result, target };
  } finally { await rm(root, { recursive: true, force: true }); }
}

export async function verifyOracles() {
  return (["diff", "patch"] as const).map(tool => ({ tool, ...oracleIdentity(tool) }));
}

export async function filesystem(files: Files = {}) {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const [name, text] of Object.entries(files)) await fs.writeFile(`/work/${name}`, Buffer.from(text));
  return fs;
}

interface RunOptions {
  readonly files?: Files;
  readonly fs?: MemoryFileSystem;
  readonly input?: string | ByteSource;
  readonly options?: DiffPatchOptions;
  readonly signal?: AbortSignal;
  readonly stdout?: ByteSink;
}

export async function run(tool: "diff" | "patch", args: readonly string[], options: RunOptions = {}) {
  const fs = options.fs ?? await filesystem(options.files);
  const command = createDiffPatchCommands(options.options).find(candidate => candidate.name === tool);
  assert(command);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let outputBytes = 0;
  const sink = (chunks: Buffer[]): ByteSink => ({ async write(chunk) {
    outputBytes += chunk.byteLength;
    assert(outputBytes <= 512 * 1024, "virtual combined output cap");
    chunks.push(Buffer.from(chunk));
  } });
  const input = options.input ?? "";
  const result = await command.execute({
    command: tool, args, cwd: "/work", env: {}, fs,
    signal: options.signal ?? new AbortController().signal,
    stdin: typeof input === "string" ? toByteSource(input) : input,
    stdout: options.stdout ?? sink(stdout), stderr: sink(stderr),
  });
  return { ...result, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), fs };
}

export async function contents(fs: MemoryFileSystem) {
  return Buffer.from(await fs.readFile("/work/target", { maxBytes: 256 * 1024 })).toString("utf8");
}

export const patchArgs = ["--batch", "--binary", "--fuzz=0", "--no-backup-if-mismatch", "target"];
export const labels = ["--label", "target", "--label", "target"];
