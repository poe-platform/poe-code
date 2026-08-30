import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { toByteSource, type ByteSource, type FileSystem } from "../../../../src/contracts/index.js";
import { createDiffPatchCommands } from "../../../../src/commands/diff-patch/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ParserCase } from "./fixtures.js";
import { oraclePath } from "../gnu-target/oracle.js";

export const owned = fileURLToPath(new URL("./", import.meta.url));
export const patchBinary = oraclePath("patch");
export const diffBinary = oraclePath("diff");
export const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

export async function product(fixture: ParserCase) {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work");
  await memory.writeFile("/work/target", Buffer.from(fixture.before));
  await memory.writeFile("/work/other", Buffer.from("old\n"));
  const mutations: string[] = [];
  const changing = new Set(["writeFile", "writeStream", "rm", "rename", "mkdir", "symlink", "link", "chmod", "utimes"]);
  const fs = new Proxy(memory, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (changing.has(String(property))) mutations.push(`${String(property)}:${String(args[0])}`);
        return Reflect.apply(value, target, args);
      };
    },
  }) as FileSystem;
  const controller = new AbortController();
  const reason = new Error(`parser-verifier cancellation: ${fixture.id}`);
  let cancellationScheduled = false;
  let cancellationFired = false;
  let timer: NodeJS.Immediate | undefined;
  const abort = () => { cancellationFired = true; controller.abort(reason); };
  let stdin: ByteSource = toByteSource(fixture.patch);
  if (fixture.cancel === "before") abort();
  if (fixture.cancel === "input") stdin = (async function* () {
    yield Buffer.from(fixture.patch.slice(0, 3));
    abort();
    yield Buffer.from(fixture.patch.slice(3));
  })();
  if (fixture.cancel === "parse") stdin = (async function* () {
    yield Buffer.from(fixture.patch);
    cancellationScheduled = true;
    timer = setImmediate(abort);
  })();
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let exitCode: number | undefined;
  let thrown: string | undefined;
  let sameAbortReason = false;
  const started = performance.now();
  try {
    const command = createDiffPatchCommands(fixture.options).find(candidate => candidate.name === "patch")!;
    const result = await command.execute({
      command: "patch", args: [...(fixture.args ?? []), "/work/target"], fs, cwd: "/work", env: {},
      signal: controller.signal, stdin,
      stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
      stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
    });
    exitCode = result.exitCode;
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
    sameAbortReason = error === reason;
  } finally {
    if (timer) clearImmediate(timer);
  }
  return {
    exitCode, thrown, sameAbortReason, cancellationScheduled, cancellationFired,
    stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(),
    target: Buffer.from(await memory.readFile("/work/target")).toString(),
    other: Buffer.from(await memory.readFile("/work/other")).toString(), mutations,
    milliseconds: performance.now() - started,
  };
}

export function productIssues(fixture: ParserCase, result: Awaited<ReturnType<typeof product>>): string[] {
  const issues: string[] = [];
  if (fixture.after !== undefined) {
    if (result.exitCode !== 0) issues.push(`valid input rejected: exit=${result.exitCode}; ${result.stderr || result.thrown}`);
    if (result.target !== fixture.after) issues.push(`wrong target bytes: expected ${JSON.stringify(fixture.after)}, got ${JSON.stringify(result.target)}`);
  } else {
    if (fixture.expectedConflict) {
      if (result.exitCode !== 1) issues.push(`GNU hunk conflict must return status 1, got ${result.exitCode}`);
      if (!/hunk 2 does not match/u.test(result.stderr)) issues.push(`missing second-hunk conflict diagnostic: ${result.stderr}`);
    }
    if (fixture.cancel) {
      if (!result.cancellationFired || !result.sameAbortReason) issues.push("cancellation was not propagated with its original reason");
    } else if (result.exitCode === 0 || result.exitCode === undefined) {
      issues.push(`invalid/over-budget input did not return failure: exit=${result.exitCode}; throw=${result.thrown}`);
    }
    if (result.target !== fixture.before) issues.push(`silent replacement/truncation: expected ${JSON.stringify(fixture.before)}, got ${JSON.stringify(result.target)}`);
    if (result.mutations.length) issues.push(`preflight failure attempted writes: ${JSON.stringify(result.mutations)}`);
    if (result.stdout !== "") issues.push(`preflight failure emitted stdout: ${JSON.stringify(result.stdout)}`);
  }
  if (result.other !== "old\n") issues.push(`unrelated/later target was changed: ${JSON.stringify(result.other)}`);
  return issues;
}

export async function executeNative(binary: string, args: readonly string[], cwd: string, input = "") {
  assert(binary === patchBinary || binary === diffBinary);
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(binary, [...args], {
      cwd, shell: false, stdio: ["pipe", "pipe", "pipe"],
      env: { LC_ALL: "C", LANG: "C", TZ: "UTC", PATH: "/usr/bin:/bin", HOME: cwd, TMPDIR: cwd },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let failure: Error | undefined;
    const stop = (error: Error) => { failure = error; child.kill("SIGKILL"); };
    const timeout = setTimeout(() => stop(new Error("GNU oracle exceeded 3000 ms")), 3000);
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]] as const) {
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 256 * 1024) stop(new Error("GNU oracle exceeded 256 KiB output"));
        else chunks.push(chunk);
      });
    }
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("close", code => {
      clearTimeout(timeout);
      if (failure) reject(failure);
      else resolve({ exitCode: code ?? 2, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() });
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "EPIPE") stop(error); });
    child.stdin.end(input);
  });
}

export async function nativePatch(before: string, patch: string) {
  const directory = await mkdtemp(join(owned, ".native-"));
  try {
    await writeFile(join(directory, "target"), before);
    await writeFile(join(directory, "other"), "old\n");
    const result = await executeNative(patchBinary, ["--batch", "--forward", "--fuzz=0", "--no-backup-if-mismatch", "--reject-file=reject", "--", "target"], directory, patch);
    const entries = await readdir(directory);
    const target = entries.includes("target") ? await readFile(join(directory, "target"), "utf8") : undefined;
    const other = await readFile(join(directory, "other"), "utf8");
    return { ...result, target, other, entries };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function nativeDiff(before: string, after: string, args: readonly string[]) {
  const directory = await mkdtemp(join(owned, ".native-"));
  try {
    await writeFile(join(directory, "before"), before);
    await writeFile(join(directory, "after"), after);
    return await executeNative(diffBinary, [...args, "--label=target", "--label=target", "--", "before", "after"], directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
