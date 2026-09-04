import { createHash } from "node:crypto";
import { createReadStream, lstatSync } from "node:fs";
import { spawn } from "node:child_process";
import { createYqCommand } from "../../../src/commands/yq/index.js";
import { toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";

export async function run(args: readonly string[], input = "", overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createYqCommand().execute({
    command: "yq", args, cwd: "/", env: {}, fs: createMemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource(input),
    stdout: { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    ...overrides,
  });
  return { status: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

export const nativeOptions = {
  skip: process.env.SAFE_BASH_TEST_YQ === undefined && process.env.SAFE_BASH_TEST_YQ_SHA256 === undefined
    ? "Requires SAFE_BASH_TEST_YQ and SAFE_BASH_TEST_YQ_SHA256 (Mike Farah v4.53.3)" : false,
};

export async function authenticateOracle(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const executable = env.SAFE_BASH_TEST_YQ;
  const digest = env.SAFE_BASH_TEST_YQ_SHA256;
  if (!executable || !executable.startsWith("/") || executable.includes("\0")) throw new Error("Requires explicit absolute SAFE_BASH_TEST_YQ");
  if (!digest || digest.length !== 64 || [...digest].some(character => !"0123456789abcdef".includes(character))) {
    throw new Error("Requires SAFE_BASH_TEST_YQ_SHA256: 64 lowercase hexadecimal characters");
  }
  const maximum = 32 * 1024 * 1024;
  const stat = lstatSync(executable);
  if (!stat.isFile() || stat.size === 0 || stat.size > maximum || (stat.mode & 0o111) === 0) throw new Error("Oracle must be a bounded regular executable");
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(executable, { highWaterMark: 65536 })) {
    size += chunk.length;
    if (size > maximum) throw new Error("Oracle exceeds byte limit");
    hash.update(chunk);
  }
  if (hash.digest("hex") !== digest) throw new Error("yq oracle SHA256 mismatch");
  return executable;
}

export async function native(args: readonly string[], input = "") {
  const executable = await authenticateOracle();
  return new Promise<{ status: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, [...args], { env: { LC_ALL: "C", NO_COLOR: "1" }, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let failure: Error | undefined;
    const fail = (error: Error) => {
      if (failure) return;
      failure = error;
      child.kill("SIGKILL");
      child.stdin.destroy();
    };
    const timer = setTimeout(() => fail(new Error("yq oracle exceeded two seconds")), 2000);
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]] as const) {
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        if (failure) return;
        if (chunk.length > 1024 * 1024 - size) { fail(new Error("yq oracle output limit")); return; }
        size += chunk.length;
        chunks.push(Buffer.from(chunk));
      });
      stream.on("error", fail);
    }
    child.on("error", fail);
    child.stdin.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "EPIPE") fail(error); });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (signal) reject(new Error(`yq oracle terminated by ${signal}`));
      else resolve({ status: status ?? -1, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() });
    });
    child.stdin.end(input);
  });
}
