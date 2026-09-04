import { createHash } from "node:crypto";
import { createReadStream, lstatSync } from "node:fs";
import { spawn } from "node:child_process";
import { createShufCommand } from "../../../src/commands/shuf/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import type { CommandContext } from "../../../src/contracts/index.js";

export const oraclePath = process.env.SAFE_BASH_TEST_SHUF;
export const nativeOptions = { skip: oraclePath === undefined ? "Requires SAFE_BASH_TEST_SHUF and SAFE_BASH_TEST_SHUF_SHA256 for reviewed GNU shuf 9.7" : false };
export const randomPath = "/dev/fd/3";
export const entropy = Uint8Array.from({ length: 16384 }, (_, index) => (index * 73 + 19) % 256);

const authenticated = new Map<string, Promise<string>>();
export async function authenticateOracle(): Promise<string> {
  const path = process.env.SAFE_BASH_TEST_SHUF;
  const expectedHash = process.env.SAFE_BASH_TEST_SHUF_SHA256;
  if (!path) throw new Error("Requires explicit SAFE_BASH_TEST_SHUF");
  if (!expectedHash || expectedHash.length !== 64 || Array.from(expectedHash).some(character => !"0123456789abcdef".includes(character))) {
    throw new Error("Requires explicit SAFE_BASH_TEST_SHUF_SHA256 (64 lowercase hexadecimal characters)");
  }
  const key = JSON.stringify([path, expectedHash]);
  const previous = authenticated.get(key);
  if (previous) return previous;
  const pending = (async () => {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error("Oracle must be a bounded regular executable");
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of createReadStream(path)) {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) throw new Error("Oracle exceeds executable byte limit");
      hash.update(chunk);
    }
    if (hash.digest("hex") !== expectedHash) throw new Error("GNU shuf oracle hash mismatch; provide the reviewed path and SHA256 together");
    return path;
  })();
  authenticated.set(key, pending);
  return pending;
}

export async function native(args: readonly string[], input: Uint8Array = new Uint8Array(), random = entropy, env: Record<string, string> = {}, captureOutput?: (bytes: Buffer) => void, closeStdout = false) {
  const path = await authenticateOracle();
  return new Promise<{ exitCode: number; stdout: Buffer; stderr: string; stderrHex: string }>((resolve, reject) => {
    const child = spawn(path, [...args], { argv0: "shuf", env: { LC_ALL: "C", ...env }, stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const fileOutput: Buffer[] = [];
    const randomPipe = child.stdio[3] as import("node:stream").Writable;
    let failure: Error | undefined;
    const fail = (error: Error) => {
      if (failure) return;
      failure = error;
      child.kill("SIGKILL");
      child.stdin!.destroy();
      randomPipe.destroy();
    };
    const timeout = setTimeout(() => fail(new Error("GNU oracle exceeded two seconds")), 2000);
    for (const [stream, chunks] of [
      [child.stdout!, stdout],
      [child.stderr!, stderr],
      [child.stdio[4] as import("node:stream").Readable, fileOutput],
    ] as const) {
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        if (failure) return;
        if (chunk.length > 1024 * 1024 - size) {
          fail(new Error("GNU oracle output limit"));
          return;
        }
        size += chunk.length;
        chunks.push(Buffer.from(chunk));
      });
      stream.on("error", fail);
    }
    child.on("error", fail);
    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      if (failure) { reject(failure); return; }
      try {
        captureOutput?.(Buffer.concat(fileOutput));
        const diagnostics = Buffer.concat(stderr);
        resolve({ exitCode: signal === "SIGPIPE" ? 141 : exitCode ?? -1, stdout: Buffer.concat(stdout), stderr: diagnostics.toString(), stderrHex: diagnostics.toString("hex") });
      } catch (error) { reject(error); }
    });
    if (closeStdout) child.stdout!.destroy();
    for (const stream of [child.stdin!, randomPipe]) {
      stream.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") fail(error);
      });
    }
    child.stdin!.end(input);
    randomPipe.end(random);
  });
}

export async function run(args: readonly string[], input: Uint8Array = new Uint8Array(), random = entropy, overrides: Partial<CommandContext> = {}) {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dev/fd", { recursive: true });
  await fs.writeFile(randomPath, random);
  await fs.writeFile("/dev/null", new Uint8Array());
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "shuf", args, cwd: "/", env: { LC_ALL: "C" }, fs,
    signal: new AbortController().signal,
    stdin: (async function* () { if (input.length) yield input; })(),
    stdout: { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    ...overrides,
  };
  const result = await createShufCommand().execute(context);
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString(), stderrHex: Buffer.concat(stderr).toString("hex"), fs: context.fs };
}
