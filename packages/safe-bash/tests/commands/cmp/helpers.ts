import { spawn } from "node:child_process";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { createCmpCommand, type CmpCommandsOptions } from "../../../src/commands/cmp/index.js";

export async function run(args: readonly string[], left: Uint8Array = Buffer.from("abc\n"), right: Uint8Array = left,
  overrides: Partial<CommandContext> = {}, options: CmpCommandsOptions = {}) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", left);
  await fs.writeFile("/right", right);
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "cmp", args, cwd: "/", env: { LC_ALL: "C" }, fs,
    stdin: toByteSource(right), signal: new AbortController().signal,
    stdout: { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    ...overrides,
  };
  const result = await createCmpCommand(options).execute(context);
  return { exitCode: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

export async function native(args: readonly string[], left: Uint8Array = new Uint8Array(), right: Uint8Array = left,
  env: Record<string, string> = {}) {
  const oracle = process.env.CMP_ORACLE;
  if (!oracle) throw new Error("GNU cmp oracle unavailable: set CMP_ORACLE explicitly");
  const childEnv: Record<string, string> = { LC_ALL: "C", ...env };
  delete childEnv.POSIXLY_CORRECT;
  const child = spawn("/bin/bash", ["-c", 'if [ "$1" = empty ]; then exec 3< <(/bin/cat <&3); fi; shift; if [ "$1" = present ]; then export POSIXLY_CORRECT="$2"; fi; shift 2; exec -a cmp "$@"',
    "cmp-oracle", left.length ? "socket" : "empty", Object.hasOwn(env, "POSIXLY_CORRECT") ? "present" : "absent", env.POSIXLY_CORRECT ?? "", oracle, ...args],
  { env: childEnv, detached: true, stdio: ["pipe", "pipe", "pipe", "pipe"] });
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  const extra = child.stdio[3] as import("node:stream").Writable;
  let outputBytes = 0, terminated = false, closed = false;
  let failure: { reason: unknown } | undefined;
  const terminate = (): void => {
    if (terminated || closed) return;
    terminated = true;
    extra.destroy();
    child.stdin!.destroy();
    if (child.pid !== undefined) {
      try { process.kill(-child.pid, "SIGKILL"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") failure ??= { reason: error }; }
    }
  };
  const fail = (reason: unknown): void => {
    if (closed) return;
    failure ??= { reason };
    terminate();
  };
  const result = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error("GNU cmp oracle timed out after 3000ms")), 3000);
    const collect = (target: Buffer[], chunk: Buffer): void => {
      if (failure) return;
      if (chunk.length > 1048576 - outputBytes) { fail(new Error("GNU cmp oracle output bytes limit exceeded")); return; }
      outputBytes += chunk.length;
      target.push(chunk);
    };
    child.stdout!.on("data", chunk => collect(stdout, chunk));
    child.stderr!.on("data", chunk => collect(stderr, chunk));
    child.stdout!.on("error", fail);
    child.stderr!.on("error", fail);
    const inputError = (error: NodeJS.ErrnoException): void => {
      if (error.code !== "EPIPE" && error.code !== "ECONNRESET" && error.code !== "ENOTCONN") fail(error);
    };
    extra.on("error", inputError);
    child.stdin!.on("error", inputError);
    child.once("error", fail);
    child.once("close", (code, signal) => {
      closed = true;
      clearTimeout(timer);
      extra.destroy();
      child.stdin!.destroy();
      if (failure) reject(failure.reason);
      else if (code === null) reject(new Error(`oracle terminated: ${signal}`));
      else resolve(code);
    });
    try { extra.end(left); child.stdin!.end(right); }
    catch (error) { fail(error); }
  });
  const exitCode = await result;
  return { exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}
