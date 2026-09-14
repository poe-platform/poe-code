import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { createMaskedSink, createSecretHandlers } from "./secrets.js";
import type { OpBackend, OpBackendRequest } from "./types.js";
import type { OpCommandContext } from "./cli.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const reference = "op://prod/db/password";

function fixture(input = "", env: Record<string, string> = {}) {
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const controller = new AbortController();
  const execute = mock.fn(async (_request: OpBackendRequest, _options: { signal: AbortSignal }): Promise<unknown> => "secret");
  const context: OpCommandContext = {
    args: [], env, signal: controller.signal,
    stdin: (async function* () { yield encoder.encode(input); })(),
    stdout: { write: mock.fn(async (data) => { output.push(data); }) },
    stderr: { write: mock.fn(async (data) => { errors.push(data); }) },
    invoke: mock.fn(async () => ({ exitCode: 7 })),
    readFile: mock.fn(async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }),
    writeFile: mock.fn(async () => {})
  };
  const handlers = createSecretHandlers({ execute } as unknown as OpBackend);
  const call = (resource: string, args: string[] = [], flags: OpBackendRequest["flags"] = {}) =>
    handlers[resource]!({ resource, action: "", args, flags }, context);
  return { context, execute, call, controller, output: () => output.map(data => decoder.decode(data)).join(""), errors: () => errors.map(data => decoder.decode(data)).join("") };
}

describe("secret handlers", () => {
  it("owns Buffer bytes before a queued masking write starts", async () => {
    const output: Uint8Array[] = [];
    let entered!: () => void;
    const writing = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void;
    const masked = createMaskedSink({ async write(data) {
      output.push(Uint8Array.from(data));
      if (output.length === 1) {
        entered();
        await new Promise<void>(resolve => { release = resolve; });
      }
    } }, ["secret"], new AbortController().signal);
    const first = masked.sink.write(encoder.encode("prefix "));
    await writing;
    const bytes = Buffer.from("secret");
    const second = masked.sink.write(bytes);
    bytes.fill(120);
    release();
    await Promise.all([first, second]);
    await masked.flush();
    assert.equal(Buffer.concat(output).toString(), "prefix <concealed by 1Password>");
  });
  it("exposes the shared masking sink for captured environment values", async () => {
    const output: Uint8Array[] = [];
    const masked = createMaskedSink({ async write(data) { output.push(data); } }, ["sëcret"], new AbortController().signal);
    for (const byte of encoder.encode("sëcret së")) await masked.sink.write(new Uint8Array([byte]));
    await masked.flush();
    assert.equal(Buffer.concat(output).toString(), "<concealed by 1Password> së");
  });
  it("awaits shared masking flush and preserves cancellation", async () => {
    const controller = new AbortController();
    let entered!: () => void;
    const writing = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void;
    const masked = createMaskedSink({ async write() { entered(); await new Promise<void>(resolve => { release = resolve; }); } }, ["secret"], controller.signal);
    await masked.sink.write(encoder.encode("sec"));
    let finished = false;
    const flushing = masked.flush().then(() => { finished = true; });
    await writing;
    assert.equal(finished, false);
    release();
    await flushing;
    const reason = new Error("cancelled capture");
    controller.abort(reason);
    await assert.rejects(masked.sink.write(encoder.encode("secret")), error => error === reason);
  });
  it("preserves ordinary shell environment text while expanding variables in secret references", async () => {
    const run = fixture("", { VAULT: "prod", LITERAL: "$VAULT", TOKEN: "prefix {{ op://$VAULT/db/password }} $VAULT" });
    let env: unknown;
    run.context.invoke = async (_command, _args, options) => { env = options.env; return { exitCode: 0 }; };
    await run.call("run", ["app"]);
    assert.deepEqual(env, { VAULT: "prod", LITERAL: "$VAULT", TOKEN: "prefix secret $VAULT" });
  });
  it("does not expand single-quoted or escaped dotenv references a second time", async () => {
    const run = fixture("", { VAULT: "prod" });
    run.context.readFile = async () => encoder.encode("TOKEN='op://$VAULT/db/password'\nESC=op://\\$VAULT/db/password\n");
    await run.call("run", ["app"], { "env-file": "input" });
    assert.deepEqual(run.execute.mock.calls.map(call => call.arguments[0].args[0]), ["op://$VAULT/db/password", "op://$VAULT/db/password"]);
  });
  it("environment sources override unresolved lower-precedence references", async () => {
    const run = fixture("", { TOKEN: "op://missing/item/field" });
    run.execute.mock.mockImplementation(async request => {
      if (request.resource !== "environment") throw new Error("must not resolve overridden reference");
      return request.args[0] === "first" ? "TOKEN=first\nKEEP=yes\n" : "TOKEN=second\n";
    });
    let env: unknown;
    run.context.invoke = async (_command, _args, options) => { env = options.env; return { exitCode: 0 }; };
    await run.call("run", ["app"], { environment: ["first", "second"] });
    assert.deepEqual(env, { TOKEN: "second", KEEP: "yes" });
  });
  it("cancels a blocked stdin iterator without waiting for input", async () => {
    const run = fixture();
    let entered!: () => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    run.context.stdin = { [Symbol.asyncIterator]() { return { next() { entered(); return new Promise<IteratorResult<Uint8Array>>(() => {}); } }; } };
    const pending = run.call("inject");
    await reading;
    const reason = new Error("abort input");
    run.controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
  });
  it("masks longest overlapping secrets and flushes partial non-secret tails", async () => {
    const run = fixture("", { SHORT: reference, LONG: reference + "2" });
    run.execute.mock.mockImplementation(async request => request.args[0] === reference ? "abc" : "abcdef");
    run.context.invoke = async (_command, _args, options) => {
      await options.stdout!.write(encoder.encode("abc"));
      await options.stdout!.write(encoder.encode("def abc ab"));
      return { exitCode: 0 };
    };
    await run.call("run", ["app"]);
    assert.equal(run.output(), "<concealed by 1Password> <concealed by 1Password> ab");
  });
  it("rejects malformed dotenv input before invoking a child", async () => {
    for (const source of ["MISSING", "KEY='unclosed", 'KEY="value" trailing']) {
      const run = fixture();
      run.context.readFile = async () => encoder.encode(source);
      run.context.invoke = async () => { assert.fail("must not invoke"); };
      await assert.rejects(run.call("run", ["app"], { "env-file": "input" }));
    }
  });
  it("reads text with a newline and forwards global flags and cancellation", async () => {
    const test = fixture();
    assert.deepEqual(await test.call("read", [reference], { account: "work" }), { exitCode: 0 });
    assert.equal(test.output(), "secret\n");
    assert.deepEqual(test.execute.mock.calls[0]?.arguments, [{ resource: "secret", action: "read", args: [reference], flags: { account: "work" } }, { signal: test.context.signal }]);
  });
  it("supports no-newline and preserves reference query parameters", async () => {
    const test = fixture();
    await test.call("read", [reference + "?attribute=otp"], { "no-newline": true });
    assert.equal(test.output(), "secret");
    assert.deepEqual(test.execute.mock.calls[0]?.arguments[0], { resource: "secret", action: "read", args: [reference + "?attribute=otp"], flags: {} });
  });
  it("writes raw file content and awaits the writer", async () => {
    const test = fixture();
    let release!: () => void;
    let entered!: () => void;
    const writing = new Promise<void>(resolve => { entered = resolve; });
    const writeFile = mock.fn(async (_path: string, _data: Uint8Array, _options?: { mode?: number; overwrite?: boolean }) => { entered(); await new Promise<void>(resolve => { release = resolve; }); });
    test.context.writeFile = writeFile;
    const pending = test.call("read", [reference], { "out-file": "key", force: true });
    await writing;
    assert.deepEqual(writeFile.mock.calls[0]?.arguments, ["key", encoder.encode("secret"), { mode: 0o600, overwrite: true }]);
    release();
    await pending;
    assert.equal(test.output(), "");
  });
  it("refuses to overwrite an existing file without force", async () => {
    const test = fixture();
    const exists = Object.assign(new Error("Output exists; use --force"), { code: "EEXIST" });
    test.context.writeFile = async (_path, _data, options) => {
      assert.equal(options?.overwrite, false);
      throw exists;
    };
    await assert.rejects(test.call("read", [reference], { "out-file": "key" }), error => error === exists);
    assert.equal(test.output(), "");
  });
  it("passes default and explicit octal modes and force to the host for read and inject", async () => {
    for (const resource of ["read", "inject"]) {
      for (const [mode, expected] of [[undefined, 0o600], ["0640", 0o640], ["600", 0o600], ["000", 0], ["0777", 0o777], ["010000", 0o10000]] as const) {
        for (const force of [undefined, false, true]) {
          const run = fixture("{{ " + reference + " }}");
          delete run.context.readFile;
          const writes: unknown[] = [];
          run.context.writeFile = async (...args) => { writes.push(args); };
          await run.call(resource, resource === "read" ? [reference] : [], { "out-file": "output", ...(mode === undefined ? {} : { "file-mode": mode }), ...(force === undefined ? {} : { force }) });
          assert.deepEqual(writes, [["output", encoder.encode("secret"), { mode: expected, overwrite: force === true }]]);
          assert.equal(run.output(), "");
        }
      }
    }
  });
  it("rejects malformed file modes before resolving or writing secrets", async () => {
    for (const mode of ["", "0999", "-1", "0x600", "0640junk", " 600", "40000000000"]) {
      const run = fixture();
      await assert.rejects(run.call("read", [reference], { "out-file": "output", "file-mode": mode }), error => error instanceof Error && error.message.includes("file-mode"));
      assert.equal(run.execute.mock.callCount(), 0);
      assert.equal(run.output(), "");
    }
  });
  it("ignores file modes without an output file", async () => {
    const run = fixture();
    await run.call("read", [reference], { "file-mode": "invalid" });
    assert.equal(run.output(), "secret\n");
  });
  it("does not emit partial secrets when a later template reference fails", async () => {
    const outputs: OpBackendRequest["flags"][] = [{}, { "out-file": "output", force: true }];
    for (const flags of outputs) {
      const run = fixture("{{ " + reference + " }} {{ op://prod/db/missing }}");
      const failure = new Error("missing field");
      run.execute.mock.mockImplementation(async request => { if (request.args[0] !== reference) throw failure; return "secret"; });
      const writes: unknown[] = [];
      run.context.writeFile = async (...args) => { writes.push(args); };
      await assert.rejects(run.call("inject", [], flags), error => error === failure);
      assert.equal(run.output(), "");
      assert.deepEqual(writes, []);
    }
  });
  it("propagates file write failures without falling back to stdout", async () => {
    for (const resource of ["read", "inject"]) {
      const run = fixture("{{ " + reference + " }}");
      const failure = new Error("write denied");
      run.context.writeFile = async () => { throw failure; };
      await assert.rejects(run.call(resource, resource === "read" ? [reference] : [], { "out-file": "output", force: true }), error => error === failure);
      assert.equal(run.output(), "");
    }
  });
  it("validates read arity", async () => {
    const args = [reference, reference];
    const test = fixture();
    await assert.rejects(test.call("read", args));
    assert.equal(test.execute.mock.callCount(), 0);
  });
  it("rejects non-text backend values", async () => {
    const test = fixture();
    test.execute.mock.mockImplementation(async () => ({ password: "secret" }));
    await assert.rejects(test.call("read", [reference]), error => error instanceof Error && error.message.includes("text"));
  });
  it("injects enclosed and bare references, defaults and case-insensitive variables", async () => {
    const test = fixture('url={{ op://${ vault:-dev}/db/password }}; bare=op://prod/db/password!', { VAULT: "prod" });
    await test.call("inject");
    assert.equal(test.output(), "url=secret; bare=secret!");
  });
  it("preserves escaped template literals and ignores embedded URI schemes", async () => {
    const test = fixture('{{ "{{ test op://prod/db/password }}" }} xop://prod/db/password');
    await test.call("inject");
    assert.equal(test.output(), "{{ test op://prod/db/password }} xop://prod/db/password");
    assert.equal(test.execute.mock.callCount(), 0);
  });
  it("reads a UTF-8 template file and writes the exact rendered content", async () => {
    const test = fixture("ignored");
    const writes: [string, Uint8Array][] = [];
    test.context.writeFile = async (path, data) => { writes.push([path, data]); };
    test.context.readFile = mock.fn(async () => encoder.encode("é {{ " + reference + " }}"));
    await test.call("inject", [], { "in-file": "input", "out-file": "output", force: true });
    assert.deepEqual(writes, [["output", encoder.encode("é secret")]]);
  });
  it("fails on malformed templates before writing", async () => {
    const test = fixture("{{ " + reference);
    await assert.rejects(test.call("inject"));
    assert.equal(test.output(), "");
  });
  it("parses dotenv quoting, multiline, escapes, comments, interpolation and precedence", async () => {
    const test = fixture("", { BASE: "shell", KEEP: "yes" });
    let invokedEnv: Readonly<Record<string, string>> | undefined;
    test.context.invoke = async (_command, _args, options) => { invokedEnv = options.env; return { exitCode: 7 }; };
    test.context.readFile = mock.fn(async (path: string) => encoder.encode(path === "first"
      ? 'BASE=file\nCOPY=${BASE}\nSINGLE=\'$BASE\'\nDOUBLE=" $BASE "\nESC="\\$BASE"\nJSON={"foo":"bar"}\nEMPTY=\nMULTI=\'one\ntwo\'\nCOMMENT=value # comment\nTOKEN={{ ' + reference + ' }}\n'
      : "BASE=last\n"));
    await test.call("run", ["app", "--flag"], { "env-file": ["first", "second"] });
    assert.deepEqual(invokedEnv, {
      BASE: "last", KEEP: "yes", COPY: "file", SINGLE: "$BASE", DOUBLE: " file ", ESC: "$BASE", JSON: '{"foo":"bar"}', EMPTY: "", MULTI: "one\ntwo", COMMENT: "value", TOKEN: "secret"
    });
    assert.deepEqual(test.context.env, { BASE: "shell", KEEP: "yes" });
  });
  it("masks UTF-8 secrets across chunks on both streams and preserves exit status", async () => {
    const test = fixture("", { TOKEN: reference });
    test.execute.mock.mockImplementation(async () => "sëcret");
    test.context.invoke = mock.fn(async (_command: string, _args: readonly string[], options: Parameters<NonNullable<OpCommandContext["invoke"]>>[2]) => {
      const bytes = encoder.encode("before sëcret after");
      for (const byte of bytes) await options.stdout!.write(new Uint8Array([byte]));
      await options.stderr!.write(encoder.encode("së"));
      await options.stderr!.write(encoder.encode("cret!"));
      return { exitCode: 23 };
    });
    assert.deepEqual(await test.call("run", ["app"]), { exitCode: 23 });
    assert.equal(test.output(), "before <concealed by 1Password> after");
    assert.equal(test.errors(), "<concealed by 1Password>!");
  });
  it("honors no-masking and passes literal child arguments", async () => {
    const test = fixture("", { TOKEN: reference });
    let invocation: unknown;
    test.context.invoke = async (...args) => { invocation = args; return { exitCode: 7 }; };
    await test.call("run", ["app", "$TOKEN", "--no-masking"], { "no-masking": true });
    assert.deepEqual(invocation, ["app", ["$TOKEN", "--no-masking"], { env: { TOKEN: "secret" }, stdout: test.context.stdout, stderr: test.context.stderr }]);
  });
  it("does not invoke a child when resolution fails", async () => {
    const test = fixture("", { TOKEN: reference });
    let invoked = false;
    test.context.invoke = async () => { invoked = true; return { exitCode: 0 }; };
    test.execute.mock.mockImplementation(async () => { throw new Error("denied"); });
    await assert.rejects(test.call("run", ["app"]), error => error instanceof Error && error.message.includes("denied"));
    assert.equal(invoked, false);
  });
  it("preserves abort reasons before and after backend calls", async () => {
    const test = fixture();
    const reason = new Error("cancelled");
    test.execute.mock.mockImplementation(async () => { test.controller.abort(reason); return "secret"; });
    await assert.rejects(test.call("read", [reference]), error => error === reason);
    assert.equal(test.output(), "");
    test.execute.mock.resetCalls();
    await assert.rejects(test.call("read", [reference]), error => error === reason);
    assert.equal(test.execute.mock.callCount(), 0);
  });
  it("propagates sink failures", async () => {
    const test = fixture();
    test.context.stdout.write = mock.fn(async () => { throw new Error("closed"); });
    await assert.rejects(test.call("read", [reference]), error => error instanceof Error && error.message.includes("closed"));
  });
  it("requires host capabilities and a child command", async () => {
    const test = fixture();
    await assert.rejects(test.call("run"));
    delete test.context.invoke;
    await assert.rejects(test.call("run", ["app"]), error => error instanceof Error && error.message.includes("invoke"));
    delete test.context.readFile;
    await assert.rejects(test.call("inject", [], { "in-file": "input" }), error => error instanceof Error && error.message.includes("readFile"));
  });
});
