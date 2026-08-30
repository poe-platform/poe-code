import assert from "node:assert/strict";
import { createWhichCommand, type WhichCommandsOptions } from "../../../src/commands/which/index.js";
import { ACCESS_MODES, type CommandContext, type FileStat, type FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";

export const file: FileStat = { type: "file", size: 0, mode: 0, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 };

export function controlled(overrides: Partial<FileSystem> = {}) {
  const calls: string[] = [];
  const base: FileSystem = {
    capabilities: {},
    async stat(path, options) {
      assert.ok(options?.signal);
      calls.push(`stat ${path}`);
      return file;
    },
    async access(path, mode, options) {
      assert.equal(mode, ACCESS_MODES.X_OK);
      assert.ok(options?.signal);
      calls.push(`access ${path}`);
    },
    async readFile() { throw new Error("forbidden readFile"); },
    async writeFile() { throw new Error("forbidden writeFile"); },
    async appendFile() { throw new Error("forbidden appendFile"); },
    async lstat() { throw new Error("forbidden lstat"); },
    async readdir() { throw new Error("forbidden readdir"); },
    async mkdir() { throw new Error("forbidden mkdir"); },
    async rm() { throw new Error("forbidden rm"); },
    async rename() { throw new Error("forbidden rename"); },
    async copyFile() { throw new Error("forbidden copyFile"); },
    async realpath() { throw new Error("forbidden realpath"); },
    ...overrides,
  };
  return { fs: base, calls };
}

export function context(args: readonly string[], overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const invocation: CommandContext = {
    command: "which", args, cwd: "/v", env: { PATH: "/a:/b" },
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    get stdin(): never { throw new Error("forbidden stdin property"); },
    get stdinIsDefault(): never { throw new Error("forbidden stdin provenance"); },
    invoke() { throw new Error("forbidden invoke"); },
    registerCleanup() { throw new Error("forbidden cleanup enrollment"); },
    stdout: { async write(bytes) { stdout.push(bytes); }, get ownedOutput(): never { throw new Error("forbidden stdout enrollment"); } },
    stderr: { async write(bytes) { stderr.push(bytes); }, get ownedOutput(): never { throw new Error("forbidden stderr enrollment"); } },
  };
  Object.defineProperties(invocation, Object.getOwnPropertyDescriptors(overrides));
  return { invocation, stdout, stderr };
}

export async function run(args: readonly string[], options: WhichCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const capture = context(args, overrides);
  const result = await createWhichCommand(options).execute(capture.invocation);
  return {
    ...result,
    stdout: Buffer.concat(capture.stdout).toString("utf8"),
    stderr: Buffer.concat(capture.stderr).toString("utf8"),
    chunks: capture.stdout,
    diagnostics: capture.stderr,
  };
}

export async function seed() {
  const fs = createMemoryFileSystem();
  for (const directory of ["/v", "/a", "/b"]) await fs.mkdir(directory);
  for (const path of ["/a/p", "/b/p", "/v/p", "/v/-", "/v/-a", "/v/--", "/v/雪", "/v/😀"]) {
    await fs.writeFile(path, new Uint8Array([255, 0, 128]));
    await fs.chmod(path, 0o700);
  }
  return fs;
}

export function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

export async function rejectsExactly(action: () => unknown, reason: unknown): Promise<void> {
  let rejected = false;
  try { await action(); }
  catch (error) { rejected = true; assert.equal(error, reason); }
  assert.ok(rejected, "must reject, including undefined/null/false reasons");
}
