
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { toByteSource, type ByteSource, type FileSystem } from "../../../../src/contracts/index.js";
import { createDiffPatchCommands } from "../../../../src/commands/diff-patch/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ParserCase } from "./fixtures.js";

export const owned = fileURLToPath(new URL("./", import.meta.url));
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
