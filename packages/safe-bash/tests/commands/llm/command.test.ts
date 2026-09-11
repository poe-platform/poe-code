import assert from "node:assert/strict";
import test from "node:test";
import { createLlmCommands, llmCommands } from "../../../src/commands/llm/command.js";
import type { LlmCommandsOptions, LlmProvider, LlmRequest } from "../../../src/commands/llm/types.js";
import { CommandRegistry, createCommandArguments, toByteSource, type CommandContext, type ByteSource } from "../../../src/contracts/index.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { byteCommands } from "../../../src/commands/bytes/index.js";
import { acceptsMimeType, sniffMimeType } from "../../../src/commands/llm/mime.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

function provider(chunks: readonly (string | Uint8Array)[] = ["hello", " world"]): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    name: "fake", models: [{ id: "text", aliases: ["chat"] }, { id: "audio", outputType: "audio/mpeg", attachmentTypes: ["image/*", "application/pdf"] }], requests,
    async *complete(request) { requests.push(request); yield* chunks; },
  };
}

async function fixture(args: readonly string[], settings: {
  provider?: LlmProvider; options?: Partial<LlmCommandsOptions>; stdin?: ByteSource; context?: Partial<CommandContext>;
} = {}) {
  const fake = settings.provider ?? provider();
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const cleanups: (() => void | Promise<void>)[] = [];
  const context: CommandContext = {
    command: "llm", args, fs, cwd: "/work", env: {}, signal: new AbortController().signal,
    stdin: settings.stdin ?? toByteSource(""),
    stdout: { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    registerCleanup(cleanup) { cleanups.push(cleanup); }, ...settings.context,
  };
  const command = createLlmCommands({ providers: [fake], defaultModel: "text", ...settings.options })[0]!;
  return { context, fs, stdout, stderr, cleanups, execute: () => command.execute(context) };
}

test("routes aliases and combines stdin content before the instruction with untouched options", async () => {
  const fake = provider();
  const run = await fixture(["-m", "chat", "summarize", "this", "-s", "be terse", "-o", "temperature", "0.70", "--option", "__proto__", "literal"], { provider: fake, stdin: toByteSource("notes") });
  assert.equal((await run.execute()).exitCode, 0);
  const request = fake.requests[0]!;
  assert.equal(request.model, "text");
  assert.equal(request.prompt, "notes\n\nsummarize this");
  assert.equal(request.system, "be terse");
  assert.deepEqual({ ...request.options }, { temperature: "0.70", ["__proto__"]: "literal" });
  assert.deepEqual(request.attachments, []);
  assert.equal(Buffer.concat(run.stdout).toString(), "hello world\n");
  assert.equal(run.stdout.length, 3);
});

test("supports stdin-only, arguments-only, empty prompts, and explicit end of options", async () => {
  for (const [args, stdin, prompt] of [[[], "input\n", "input\n"], [["words"], "", "words"], [[], "", ""], [["--", "-m", "models"], "", "-m models"]] as const) {
    const fake = provider();
    const run = await fixture(args, { provider: fake, stdin: toByteSource(stdin) });
    assert.equal((await run.execute()).exitCode, 0);
    assert.equal(fake.requests[0]!.prompt, prompt);
  }
});

test("supports attached flag values and last-option-wins", async () => {
  const fake = provider();
  const run = await fixture(["--model=missing", "-mchat", "--system=one", "-stwo", "--option=key", "first", "-okey", "second"], { provider: fake });
  assert.equal((await run.execute()).exitCode, 0);
  assert.equal(fake.requests[0]!.system, "two");
  assert.equal(fake.requests[0]!.options.key, "second");
});

test("raw argument bytes and stdin must be fatal UTF-8 before provider admission", async () => {
  for (const values of [[Uint8Array.of(255)], ["--system", Uint8Array.of(255)], ["--model=chat", Uint8Array.of(255)]]) {
    const argumentValues = createCommandArguments(values.map(value => typeof value === "string" ? value : shellValueFromBytes(value)));
    const fake = provider();
    const run = await fixture(argumentValues.args, { provider: fake, context: { argumentValues } });
    assert.equal((await run.execute()).exitCode, 1);
    assert.equal(fake.requests.length, 0);
  }
  const fake = provider();
  const run = await fixture([], { provider: fake, stdin: toByteSource(Uint8Array.of(255)) });
  assert.equal((await run.execute()).exitCode, 1);
  assert.equal(fake.requests.length, 0);
});

test("provider text writes remain bounded across internal and provider surrogate splits", async () => {
  const text = "a".repeat(16_383) + "😀" + "b".repeat(40_000) + "\ud83e";
  const run = await fixture([], { provider: provider([text, "", "\udd8a"]) });
  assert.equal((await run.execute()).exitCode, 0);
  assert.deepEqual(Buffer.concat(run.stdout), Buffer.from(text + "\udd8a\n"));
  assert.ok(run.stdout.every(chunk => chunk.byteLength <= 16_384 * 3));
});

test("MIME classification retains remote structured and plain text detection", () => {
  assert.equal(sniffMimeType("/unknown", Buffer.from('{"value":1}')), "application/json");
  assert.equal(sniffMimeType("/unknown", Buffer.from("plain text")), "text/plain");
  assert.equal(sniffMimeType("/unknown", Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0)), "application/wasm");
});

test("unknown models fail without reading input or invoking providers", async () => {
  const fake = provider();
  const run = await fixture([], { provider: fake, options: { defaultModel: "missing" }, stdin: { [Symbol.asyncIterator]() { return assert.fail("must not read stdin"); } } });
  assert.equal((await run.execute()).exitCode, 1);
  assert.equal(fake.requests.length, 0);
  assert.equal(Buffer.concat(run.stderr).toString(), "Unknown model: missing\n");
});

test("malformed arguments never invoke the provider", async () => {
  for (const args of [["-m"], ["--system"], ["-o", "key"], ["--at", "file"], ["-a"], ["--unknown"], ["-c"]]) {
    const fake = provider();
    const run = await fixture(args, { provider: fake });
    assert.notEqual((await run.execute()).exitCode, 0, args.join(" "));
    assert.equal(fake.requests.length, 0);
  }
});

test("preflights all id, alias, and qualified-name collisions", () => {
  for (const models of [
    [{ id: "same" }, { id: "same" }],
    [{ id: "first", aliases: ["same"] }, { id: "same" }],
    [{ id: "first", aliases: ["same"] }, { id: "second", aliases: ["same"] }],
    [{ id: "first" }, { id: "fake/first" }],
  ]) assert.throws(() => createLlmCommands({ providers: [{ ...provider(), models }] }), /[Dd]uplicate|[Cc]ollision/);
  assert.throws(() => createLlmCommands({ providers: [provider(), { ...provider(), name: "other" }] }), /[Dd]uplicate|[Cc]ollision/);
});

test("lists all provider models without requiring a default or reading stdin", async () => {
  const run = await fixture(["models"], { stdin: { [Symbol.asyncIterator]() { return assert.fail("must not read stdin"); } } });
  assert.equal((await run.execute()).exitCode, 0);
  const text = Buffer.concat(run.stdout).toString();
  for (const value of ["fake/text", "chat", "text/plain", "fake/audio", "image/*", "application/pdf", "audio/mpeg"]) assert.ok(text.includes(value), value);
});

test("multi-provider qualified routing preserves provider this binding", async () => {
  const other = { ...provider(["second"]), name: "other", models: [{ id: "second", aliases: ["two"] }] };
  other.complete = async function* (request) { assert.equal(this, other); this.requests.push(request); yield "second"; };
  const run = await fixture(["-m", "other/second"], { options: { providers: [provider(), other] } });
  assert.equal((await run.execute()).exitCode, 0);
  assert.equal(other.requests[0]!.model, "second");
});

test("attachments use VFS relative paths, magic over extension, fallback, explicit types, and retain bytes", async () => {
  const fake = provider([Uint8Array.of(0, 255, 128)]);
  const run = await fixture(["-m", "audio", "-a", "image.txt", "-a", "fallback.JPG", "--at", "custom", "application/pdf"], { provider: fake });
  const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  await run.fs.writeFile("/work/image.txt", png);
  await run.fs.writeFile("/work/fallback.JPG", Uint8Array.of(1));
  await run.fs.writeFile("/work/custom", Uint8Array.of(2));
  assert.equal((await run.execute()).exitCode, 0);
  assert.deepEqual(fake.requests[0]!.attachments.map(attachment => attachment.mimeType), ["image/png", "image/jpeg", "application/pdf"]);
  assert.deepEqual(fake.requests[0]!.attachments[0]!.bytes, png);
  assert.deepEqual(Buffer.concat(run.stdout), Buffer.from([0, 255, 128]));
});

test("rejects unsupported attachments before complete and refuses URLs", async () => {
  const fake = provider();
  const run = await fixture(["-a", "image.png"], { provider: fake });
  await run.fs.writeFile("/work/image.png", Uint8Array.of(1));
  assert.equal((await run.execute()).exitCode, 1);
  assert.equal(Buffer.concat(run.stderr).toString(), "Model text does not accept image/png\n");
  assert.equal(fake.requests.length, 0);
  const url = await fixture(["-a", "https://example.invalid/image.png"]);
  assert.equal((await url.execute()).exitCode, 1);
  assert.match(Buffer.concat(url.stderr).toString(), /URL/);
});

test("missing files and directories fail without a request", async () => {
  for (const path of ["missing", "/work"]) {
    const fake = provider();
    const run = await fixture(["--at", path, "text/plain"], { provider: fake });
    assert.equal((await run.execute()).exitCode, 1);
    assert.equal(fake.requests.length, 0);
  }
});

test("input admission is cumulative across stdin and all attachments", async () => {
  const fake = provider();
  const bytes = new Uint8Array(16);
  const run = await fixture(["-m", "audio", "--at", "first", "image/png", "--at", "second", "image/png"], { provider: fake, stdin: toByteSource("content"), context: {
    inputBudget: { maxBytes: 32, check(total) { if (total > 32) throw new Error("input limit exceeded"); } },
  } });
  await run.fs.writeFile("/work/first", bytes);
  await run.fs.writeFile("/work/second", bytes);
  assert.equal((await run.execute()).exitCode, 1);
  assert.match(Buffer.concat(run.stderr).toString(), /limit|maximum|large/i);
  assert.equal(fake.requests.length, 0);
});

test("response kind must match outputType and may never mix strings and bytes", async () => {
  for (const [model, chunks, expected] of [
    ["text", ["first", Uint8Array.of(65)], "first"],
    ["text", [Uint8Array.of(65)], ""],
    ["audio", [Uint8Array.of(65), "second"], "A"],
    ["audio", ["first"], ""],
  ] as const) {
    const run = await fixture(["-m", model], { provider: provider(chunks) });
    assert.equal((await run.execute()).exitCode, 1);
    assert.equal(Buffer.concat(run.stdout).toString(), expected);
    assert.match(Buffer.concat(run.stderr).toString(), /[Pp]rovider/);
  }
});

test("streaming awaits each sink before advancing, then closes exactly once", async () => {
  const events: string[] = [];
  const fake = provider();
  fake.complete = async function* () {
    try { events.push("first"); yield "one"; events.push("second"); yield "two"; }
    finally { events.push("closed"); }
  };
  const run = await fixture([], { provider: fake, context: { stdout: { async write(chunk) { events.push(new TextDecoder().decode(chunk)); } } } });
  assert.equal((await run.execute()).exitCode, 0);
  await Promise.all(run.cleanups.map(cleanup => cleanup()));
  assert.deepEqual(events, ["first", "one", "second", "two", "closed", "\n"]);
});

test("cancellation interrupts pending next and detaches opaque provider cleanup", async () => {
  const controller = new AbortController();
  const entered = deferred();
  const released = deferred();
  let returns = 0;
  let signal: AbortSignal | undefined;
  const fake: LlmProvider = { ...provider(), complete(request) {
    signal = request.signal;
    return { [Symbol.asyncIterator]() { return {
      next() { entered.resolve(); return new Promise<IteratorResult<string>>(() => {}); },
      async return() { returns++; await released.promise; return { done: true, value: undefined }; },
    }; } };
  } };
  const run = await fixture([], { provider: fake, context: { signal: controller.signal } });
  const pending = run.execute();
  await entered.promise;
  const reason = new Error("cancelled");
  controller.abort(reason);
  assert.equal(signal!.aborted, true);
  await assert.rejects(Promise.resolve(pending), error => error === reason);
  assert.equal(returns, 1);
  released.resolve();
});

test("sink failure aborts provider work and propagates unchanged", async () => {
  const failure = new Error("sink failed");
  const fake = provider();
  let closed = false;
  fake.complete = async function* (request) {
    try { yield "chunk"; assert.fail("must not advance"); }
    finally { closed = request.signal.aborted; }
  };
  const run = await fixture([], { provider: fake, context: { stdout: { async write() { throw failure; } } } });
  await assert.rejects(Promise.resolve(run.execute()), error => error === failure);
  assert.equal(closed, true);
});

test("plugins preflight replacement and work in real Shell pipelines and binary VFS redirects", async () => {
  const commands = new CommandRegistry([{ name: "llm", execute: () => ({ exitCode: 7 }) }]);
  const host = { commands, use() {}, registerFileSystem() {} };
  assert.throws(() => llmCommands({ providers: [provider()] }).setup(host), /already registered/);
  llmCommands({ providers: [provider()], replace: true }).setup(host);
  const fs = new MemoryFileSystem();
  const text = provider();
  const binary = { ...provider([Uint8Array.of(0, 255, 128)]), name: "binary", models: [{ id: "raw", outputType: "image/png" }] };
  const shell = new Shell({ fs }).use(standardCommands()).use(byteCommands()).use(llmCommands({ providers: [text, binary], defaultModel: "text" }));
  const result = await shell.exec("printf notes | llm summarize; llm -m raw picture > /picture.png");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello world\n");
  assert.equal(text.requests[0]!.prompt, "notes\n\nsummarize");
  assert.deepEqual(await fs.readFile("/picture.png"), Uint8Array.of(0, 255, 128));
  const piped = await shell.exec("llm -m raw picture | base64");
  assert.equal(piped.stdout, "AP+A\n");
});

test("shell output and stdin budgets remain active", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxOutputBytes: 4, maxInputBytes: 4 } })
    .use(llmCommands({ providers: [provider()], defaultModel: "text" }));
  await assert.rejects(shell.exec("llm hello"), /maxOutputBytes/);
  await assert.rejects(shell.exec("llm", { stdin: "12345" }), /maxInputBytes/);
});

test("attachments obey the configured shell input budget before provider invocation", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/five", new TextEncoder().encode("12345"));
  const fake = { ...provider(), models: [{ id: "text", attachmentTypes: ["text/plain"] }] };
  const shell = new Shell({ fs, limits: { maxInputBytes: 4 } }).use(llmCommands({ providers: [fake], defaultModel: "text" }));
  await assert.rejects(shell.exec("llm --at /five text/plain"), { name: "ShellLimitError", message: "Shell limit exceeded: maxInputBytes" });
  assert.equal(fake.requests.length, 0);
});

test("zero shell input budget permits argv prompts and empty attachments", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/empty", new Uint8Array());
  const fake = { ...provider(), models: [{ id: "text", attachmentTypes: ["text/plain"] }] };
  const shell = new Shell({ fs, limits: { maxInputBytes: 0 } }).use(llmCommands({ providers: [fake], defaultModel: "text" }));
  assert.equal((await shell.exec("llm 'an argument-only prompt'")).exitCode, 0);
  assert.equal((await shell.exec("llm --at /empty text/plain 'another prompt'")).exitCode, 0);
  assert.equal(fake.requests.length, 2);
});

test("shell input admission combines stdin and attachments without charging prompt or separator bytes", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/three", new TextEncoder().encode("123"));
  const fake = { ...provider(), models: [{ id: "text", attachmentTypes: ["text/plain"] }] };
  const shell = new Shell({ fs, limits: { maxInputBytes: 4 } }).use(llmCommands({ providers: [fake], defaultModel: "text" }));
  assert.equal((await shell.exec("llm --at /three text/plain 'summarize this'", { stdin: "a" })).exitCode, 0);
  assert.equal(fake.requests[0]!.prompt, "a\n\nsummarize this");
  await assert.rejects(shell.exec("llm --at /three text/plain", { stdin: "ab" }), /maxInputBytes/);
  await assert.rejects(shell.exec("llm --at /three text/plain --at /three text/plain"), /maxInputBytes/);
  assert.equal(fake.requests.length, 1);
});

test("no configured default never silently selects the first model", async () => {
  const fake = provider();
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(llmCommands({ providers: [fake] }));
  const result = await shell.exec("llm question");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "No model selected; use --model or configure defaultModel\n");
  assert.equal(fake.requests.length, 0);
  assert.equal((await shell.exec("llm models")).exitCode, 0);
});

test("MIME sniff recognizes image, audio, video and generic magic before filename fallback", () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  for (const [bytes, expected] of [
    [Uint8Array.of(255, 216, 255), "image/jpeg"], [encode("GIF89a"), "image/gif"],
    [encode("RIFF0000WEBP"), "image/webp"], [encode("RIFF0000WAVE"), "audio/wav"],
    [encode("RIFF0000AVI "), "video/x-msvideo"], [encode("fLaC"), "audio/flac"],
    [encode("ID3"), "audio/mpeg"], [Uint8Array.of(255, 251), "audio/mpeg"],
    [Uint8Array.of(255, 241), "audio/aac"], [encode("OggS"), "audio/ogg"],
    [encode("0000ftypisom"), "video/mp4"], [encode("0000ftypM4A "), "audio/mp4"],
    [encode("0000ftypavif"), "image/avif"], [encode("0000ftypheic"), "image/heic"],
    [encode("0000ftypqt  "), "video/quicktime"], [encode("%PDF-"), "application/pdf"],
  ] as const) assert.equal(sniffMimeType("wrong.txt", bytes), expected);
  assert.equal(sniffMimeType("fallback.MP4", Uint8Array.of(0)), "video/mp4");
  assert.equal(sniffMimeType("/dot.jpg/no-extension", Uint8Array.of(0)), "application/octet-stream");
  assert.equal(sniffMimeType("unknown.constructor", Uint8Array.of(0)), "application/octet-stream");
  assert.equal(acceptsMimeType(["image/*"], "image/png"), true);
  for (const mime of ["image/", "image/png/extra", "notimage/png", "image/png\n"]) assert.equal(acceptsMimeType(["image/*"], mime), false, mime);
});

test("streaming input decodes split UTF-8 and snapshots reused producer slabs", async () => {
  const fake = provider();
  const slab = Uint8Array.of(0xc3);
  const run = await fixture([], { provider: fake, stdin: (async function* () {
    yield slab; slab[0] = 0xa9; yield slab; slab[0] = 0;
  })() });
  assert.equal((await run.execute()).exitCode, 0);
  assert.equal(fake.requests[0]!.prompt, "é");
});

test("empty responses preserve text newline and binary emptiness", async () => {
  for (const model of ["text", "audio"]) {
    const run = await fixture(["-m", model], { provider: provider([]) });
    assert.equal((await run.execute()).exitCode, 0);
    assert.equal(Buffer.concat(run.stdout).toString(), model === "text" ? "\n" : "");
  }
});

test("cancelled commands never acquire provider work", async () => {
  const controller = new AbortController();
  const reason = new Error("already cancelled");
  controller.abort(reason);
  const fake = provider();
  const run = await fixture([], { provider: fake, context: { signal: controller.signal } });
  await assert.rejects(Promise.resolve(run.execute()), error => error === reason);
  assert.equal(fake.requests.length, 0);
});

test("registration snapshots mutable model declarations", async () => {
  const models = [{ id: "original", aliases: ["alias"], attachmentTypes: ["image/png"] }];
  const fake = { ...provider(), models };
  const run = await fixture(["-m", "alias"], { provider: fake });
  models[0]!.id = "mutated";
  models[0]!.aliases.push("late");
  assert.equal((await run.execute()).exitCode, 0);
  assert.equal(fake.requests[0]!.model, "original");
});

test("output consumer closure cancels pending provider work and drains cooperative cleanup", async () => {
  const closed = new AbortController();
  const entered = deferred();
  let returned = 0;
  const fake: LlmProvider = { ...provider(), complete(request) { return { [Symbol.asyncIterator]() { return {
    next() { entered.resolve(); return new Promise<IteratorResult<string>>((_resolve, reject) => {
      request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
    }); },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } }; } };
  const run = await fixture([], { provider: fake, context: { stdout: {
    async write() { assert.fail("not used"); }, ownedOutput: { consumerClosed: closed.signal, async write() { assert.fail("not used"); } },
  } } });
  const pending = run.execute();
  await entered.promise;
  const reason = new Error("consumer closed");
  closed.abort(reason);
  await assert.rejects(Promise.resolve(pending), error => error === reason);
  assert.equal(returned, 1);
});

test("cancellation drains invocation-owned stdin cleanup before settling", async () => {
  const controller = new AbortController();
  const entered = deferred(), closing = deferred(), release = deferred();
  let returns = 0;
  const run = await fixture([], { context: { signal: controller.signal }, stdin: {
    [Symbol.asyncIterator]() { return {
      next() { entered.resolve(); return new Promise<IteratorResult<Uint8Array>>(() => {}); },
      async return() { returns++; closing.resolve(); await release.promise; return { done: true, value: undefined }; },
    }; },
  } });
  const pending = Promise.resolve(run.execute());
  await entered.promise;
  let settled = false;
  void pending.then(() => { settled = true; }, () => { settled = true; });
  const reason = new Error("cancel input");
  controller.abort(reason);
  await closing.promise;
  await new Promise<void>(resolve => setImmediate(resolve));
  const settledBeforeCleanup = settled;
  release.resolve();
  await assert.rejects(pending, error => error === reason);
  assert.equal(settledBeforeCleanup, false);
  assert.equal(returns, 1);
});

test("provider failure aborts its signal before a potentially slow diagnostic write", async () => {
  let providerSignal: AbortSignal | undefined;
  const fake = provider();
  fake.complete = async function* (request) { providerSignal = request.signal; yield "partial"; throw new Error("provider failed"); };
  let abortedAtDiagnostic = false;
  const run = await fixture([], { provider: fake, context: { stderr: { async write() { abortedAtDiagnostic = providerSignal!.aborted; } } } });
  assert.equal((await run.execute()).exitCode, 1);
  assert.equal(abortedAtDiagnostic, true);
  assert.equal(Buffer.concat(run.stdout).toString(), "partial");
});
