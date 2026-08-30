import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { FsError, type ByteSource, type CommandContext, type FileSystem } from "../../../src/contracts/index.js";
import type { TableTextCommandsOptions } from "../../../src/commands/table-text/index.js";

const factory: typeof import("../../../src/commands/table-text/index.js") = await import(process.env.TABLE_TEXT_CONTROL_MODULE ?? "../../../src/commands/table-text/index.js");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function execute(command: string, args: string[], source: ByteSource, files: Record<string, string> = {}, options: TableTextCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const fs = overrides.fs ?? createMemoryFileSystem();
  for (const [name, text] of Object.entries(files)) await fs.writeFile(`/${name}`, Buffer.from(text));
  const output: Uint8Array[] = [], errors: Uint8Array[] = [];
  const context: CommandContext = { command, args, cwd: "/", fs, env: { LC_ALL: "C" }, stdin: source, signal: new AbortController().signal, stdout: { async write(bytes) { output.push(Uint8Array.from(bytes)); } }, stderr: { async write(bytes) { errors.push(Uint8Array.from(bytes)); } }, ...overrides };
  const result = await factory.createTableTextCommands(options).find(definition => definition.name === command)!.execute(context);
  return { ...result, stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString() };
}
async function* bytes(text: string) { yield Buffer.from(text); }
for (const command of ["paste", "comm", "join"]) {
  const args = command === "paste" ? ["-"] : ["-", "right"];
  const files = { right: command === "join" ? "a right\n" : "z\n" };
  test(`${command} fragmented reused Buffer has consumer-owned records`, async () => {
    const fragment = Buffer.alloc(2);
    async function* source() {
      for (const text of ["a ", "xx", "\nb", " y", "y\n"]) { fragment.write(text); yield fragment; }
    }
    const actual = await execute(command, args, source(), files);
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.equal(actual.stdout, command === "paste" ? "a xx\nb yy\n" : command === "comm" ? "a xx\nb yy\n\tz\n" : "a xx right\n");
  });
  test(`${command} blocked sink awaits writes and observes cancellation`, async () => {
    const entered = deferred(), controller = new AbortController(), reason = new FsError("ENOENT", { message: "independent cancellation" });
    let active = 0, reads = 0, closed = false;
    async function* source() { try { reads++; yield Buffer.from("a left\n"); reads++; yield Buffer.from("b tail\n"); } finally { closed = true; } }
    const running = execute(command, args, source(), files, {}, { signal: controller.signal, stdout: { async write() { assert.equal(++active, 1); entered.resolve(); await new Promise<void>(() => {}); } } });
    const rejected = assert.rejects(running, error => error === reason);
    await entered.promise;
    const atBlock = reads;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(reads, atBlock);
    controller.abort(reason);
    await rejected;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(closed, true);
  });
  test(`${command} input failure is not silently successful`, async () => {
    async function* source() { yield Buffer.from("a left\n"); throw new FsError("EIO", { message: "independent producer failure" }); }
    const actual = await execute(command, args, source(), files);
    assert.equal(actual.exitCode, 1);
    assert.match(actual.stderr, /independent producer failure/u);
  });
  test(`${command} blocked VFS stat receives cancellation`, async () => {
    const entered = deferred(), controller = new AbortController(), reason = new Error("cancel VFS stat");
    const base = createMemoryFileSystem();
    let received: AbortSignal | undefined;
    const fs: FileSystem = new Proxy(base, { get(target, key) {
      if (key === "stat") return async (_path: string, options?: { signal?: AbortSignal }) => {
        received = options?.signal;
        entered.resolve();
        return new Promise<never>((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true }));
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const running = execute(command, command === "paste" ? ["file"] : ["file", "right"], bytes(""), {}, {}, { fs, signal: controller.signal });
    const rejected = assert.rejects(running, error => error === reason);
    await entered.promise; controller.abort(reason); await rejected;
    assert.equal(received?.aborted, true);
  });
  for (const [limit, maximum, message] of [["maxInputBytes", 2, "input"], ["maxChunkBytes", 2, "chunk"], ["maxRecordBytes", 2, "record"], ["maxOutputBytes", 1, "output"]] as const) {
    test(`${command} ${limit} is an explicit bounded failure`, async () => {
      const actual = await execute(command, args, bytes("a left\n"), files, { limits: { [limit]: maximum } });
      assert.equal(actual.exitCode, 1);
      assert.match(actual.stderr, new RegExp(`${message} limit`, "u"));
    });
  }
}
test("shared stdin creates one cursor and closes one producer", async () => {
  let starts = 0, closes = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { starts++; return (async function* () { try { yield Buffer.from("1\n2\n3\n4\n"); } finally { closes++; } })(); } };
  const result = await execute("paste", ["-", "-"], source);
  assert.equal(result.stdout, "1\t2\n3\t4\n");
  assert.equal(result.exitCode, 0);
  assert.equal(starts, 1); assert.equal(closes, 1);
});
for (const [limit, maximum, message] of [["maxGroupBytes", 4, "group byte"], ["maxGroupRecords", 2, "group record"], ["maxFields", 1, "field"], ["maxFiles", 1, "file"], ["maxSteps", 2, "step"], ["maxArgumentBytes", 1, "argument"]] as const) {
  test(`join ${limit} bounds independent work`, async () => {
    const actual = await execute("join", ["-", "right"], bytes("a left\na more\n"), { right: "a right\na tail\n" }, { limits: { [limit]: maximum } });
    assert.equal(actual.exitCode, 1); assert.match(actual.stderr, new RegExp(`${message} limit`, "u"));
  });
}
test("C/POSIX locale accepted while non-C ordering is explicit", async () => {
  for (const locale of ["C", "POSIX", "en_US.UTF-8"]) {
    const actual = await execute("join", ["-", "right"], bytes("a left\n"), { right: "a right\n" }, {}, { env: { LC_ALL: locale } });
    assert.equal(actual.exitCode, locale === "en_US.UTF-8" ? 1 : 0);
    if (locale === "en_US.UTF-8") assert.match(actual.stderr, /C\/POSIX/u);
    else assert.equal(actual.stdout, "a left right\n");
  }
});
