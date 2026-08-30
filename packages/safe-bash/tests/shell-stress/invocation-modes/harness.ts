import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import type { InvocationCase, Fixture } from "./cases.js";

export const owned = "tests/shell-stress/invocation-modes";
export const sha256 = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;
export const inputBytes = (row: InvocationCase): Buffer => row.stdinHex === undefined ? Buffer.from(row.stdin ?? "") : Buffer.from(row.stdinHex, "hex");
export const fixtureBytes = (fixture: Fixture, interpreter: string): Buffer => Buffer.concat([
  Buffer.from((fixture.body ?? "").replaceAll("{{bash}}", interpreter)),
  Buffer.from(fixture.hex ?? "", "hex"),
]);

export interface ProcessResult {
  readonly argv: readonly string[];
  readonly argv0: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly pid: number | undefined;
  readonly code: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly overflow: boolean;
  readonly stdoutHex: string;
  readonly stderrHex: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly elapsedMs: number;
}

export async function boundedProcess(executable: string, args: readonly string[], options: {
  cwd: string; env: Record<string, string>; input?: Uint8Array; argv0?: string; deadlineMs?: number;
}): Promise<ProcessResult> {
  const started = performance.now();
  const child = spawn(executable, [...args], { cwd: options.cwd, env: options.env, argv0: options.argv0 ?? executable, detached: true, stdio: "pipe" });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let timedOut = false;
  let overflow = false;
  let size = 0;
  const kill = (): void => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } };
  const timer = setTimeout(() => { timedOut = true; kill(); }, options.deadlineMs ?? 4000);
  const capture = (target: Buffer[]) => (chunk: Buffer): void => {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) { overflow = true; kill(); } else target.push(chunk);
  };
  child.stdout.on("data", capture(stdout));
  child.stderr.on("data", capture(stderr));
  child.stdin.on("error", () => {});
  child.stdin.end(options.input ?? Buffer.alloc(0));
  try {
    const outcome = await new Promise<{ code: number | null; signal: string | null }>((accept, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => accept({ code, signal }));
    });
    return { argv: [executable, ...args], argv0: options.argv0 ?? executable, cwd: options.cwd, env: options.env,
      pid: child.pid, ...outcome, timedOut, overflow, stdoutHex: Buffer.concat(stdout).toString("hex"), stderrHex: Buffer.concat(stderr).toString("hex"),
      stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), elapsedMs: performance.now() - started };
  } finally { clearTimeout(timer); kill(); }
}

export async function sourceHashes(directory = "src"): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(hashes, await sourceHashes(path));
    else if (/\.(?:ts|js|mjs)$/u.test(entry.name)) hashes[path] = sha256(await readFile(path));
  }
  return hashes;
}

export const head = (): string => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
export const sanitizedEnv = (): Record<string, string> => ({ PATH: "base", HOME: "/nonexistent", LC_ALL: "C", LANG: "C", TZ: "UTC" });
export async function immutableJson(name: string, value: unknown): Promise<void> {
  const target = resolve(owned, name);
  if (!relative(resolve(owned), target).startsWith("..")) await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  else throw new Error("Evidence must stay in the owned directory");
}
