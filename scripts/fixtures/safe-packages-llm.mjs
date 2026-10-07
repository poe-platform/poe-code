const assert = {
  equal(actual, expected, message) { if (actual !== expected) throw new Error(message || `Expected ${String(actual)} === ${String(expected)}`); },
  match(actual, pattern) { if (!pattern.test(String(actual))) throw new Error(`Expected ${String(actual)} to match ${pattern}`); },
  throws(fn, pattern) {
    let caught;
    try { fn(); } catch (error) { caught = error; }
    if (!caught || (pattern && !pattern.test(String(caught?.message ?? caught)))) throw new Error("Expected function to throw");
  },
  async rejects(promise, predicate) {
    let caught, threw = false;
    try { await promise; } catch (error) { caught = error; threw = true; }
    if (!threw || (predicate && !predicate(caught))) throw new Error("Expected promise to reject");
  },
};
import { CommandRegistry, commandRuntimeIdentity, getCommandArguments } from "@poe-platform/safe-bash/contracts/command";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";
import { Shell, FsError as rootFsError, MemoryFileSystem, agentCommands, createLlmService as rootService, llmCommands as rootPlugin, createOpenAiProvider as rootOpenAi, createElevenLabsProvider as rootElevenLabs } from "@poe-platform/safe-bash";
import { llmCommands, createLlmService, createLlmCommand, createLlmUrlSource, getLlmAttachmentUrlId } from "@poe-platform/safe-bash/commands/llm";
import { createOpenAiProvider, createElevenLabsProvider } from "@poe-platform/safe-bash/commands/llm/providers";

export async function verifyLlmCommands() {
  await verifyStreamedInputs();
  await verifyLlmPluginDiagnostics();
  assert.equal(rootFsError, FsError);
  const commands = new CommandRegistry([{ name: "llm", execute: () => ({ exitCode: 7 }) }]);
  const host = { commands, use() {}, registerFileSystem() {} };
  assert.throws(() => llmCommands({ providers: [] }).setup(host), /already registered/);
  llmCommands({ providers: [], replace: true }).setup(host);
  const service = createLlmService({ defaultModel: "echo", providers: [{ name: "test", models: [{ id: "echo" }], async *complete(request) { yield request.prompt; } }] });
  const chunks = [];
  for await (const chunk of service.complete({ prompt: "structured", attachments: [], options: {}, signal: new AbortController().signal })) chunks.push(chunk);
  if (chunks.length !== 1 || chunks[0] !== "structured") throw new Error("LLM structured service adds shell formatting");
  const rich = createLlmService({ defaultModel: "chat", providers: [{
    name: "independent", models: [{ id: "chat", capabilities: ["messages", "schema", "embed"] }],
    async *complete(request) {
      if (request.options.temperature !== 0.5 || request.options.store !== false || request.messages[0].content !== "previous" || request.schema.type !== "object") throw new Error("LLM structured fields lost at provider boundary");
      yield "answer";
      return { usage: { input: 2 }, metadata: { id: "independent" } };
    },
    async embed(request) { return { model: request.model, vectors: request.inputs.map(() => [1, 2]) }; },
  }] });
  const events = [];
  for await (const event of rich.stream({ prompt: "hello", messages: [{ role: "assistant", content: "previous" }], schema: { type: "object" }, attachments: [], options: { temperature: 0.5, store: false }, maxOutputBytes: 6, signal: new AbortController().signal })) events.push(event);
  if (rich.version !== 1 || events.length !== 2 || events[0].text !== "answer" || events[1].response.usage.input !== 2 || events[1].response.metadata.id !== "independent") throw new Error("LLM structured stream contract mismatch");
  const embedding = await rich.embed({ inputs: ["one"], options: {}, signal: new AbortController().signal });
  if (embedding.model !== "chat" || embedding.vectors[0][1] !== 2) throw new Error("LLM embeddings unavailable to independent consumers");
  if (rootService !== createLlmService || rootPlugin !== llmCommands || rootOpenAi !== createOpenAiProvider || rootElevenLabs !== createElevenLabsProvider) throw new Error("LLM root/subpath identity mismatch");
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands()).use(llmCommands({
    defaultModel: "text", providers: [
      { name: "first", models: [{ id: "text" }], async *complete(request) { yield request.prompt; } },
      { name: "second", models: [{ id: "audio", aliases: ["sound"], outputType: "audio/mpeg" }], async *complete() { yield new Uint8Array([0, 255, 13, 10]); } },
    ],
  }));
  try {
    const text = await shell.exec("printf hello | llm | cat");
    if (text.exitCode !== 0 || text.stdout !== "hello\n") throw new Error(`LLM text pipeline: ${text.stderr}`);
    const binary = await shell.exec("llm -m sound generate | cat");
    if (binary.exitCode !== 0 || binary.stdoutBytes.length !== 4 || binary.stdoutBytes.some((byte, index) => byte !== [0, 255, 13, 10][index])) throw new Error("LLM binary pipeline corrupted bytes");
    await fs.writeFile("/llm.sh", new TextEncoder().encode("printf script | llm | cat"));
    const script = await shell.exec("sh /llm.sh");
    assert.equal(script.exitCode, 0, script.stderr);
    assert.equal(script.stdout, "script\n");
  } finally { await shell.dispose(); }

  let witnessed = false;
  const boundary = new Shell({ fs: new MemoryFileSystem() });
  boundary.use({ name: "llm-boundary", setup(host) {
    host.commands.register({ name: "raw", async execute(context) {
      await context.stdout.write(new Uint8Array([255]));
      return { exitCode: 0 };
    } });
    const command = createLlmCommand({ defaultModel: "echo", providers: [{ name: "test", models: [{ id: "echo" }], async *complete(request) { yield request.prompt; } }] });
    host.commands.register({ name: "witness", runtimeIdentity: commandRuntimeIdentity, async execute(context) {
      const carrier = getCommandArguments(context);
      assert.equal(carrier.bytes(0)[0], 255);
      witnessed = true;
      return command.execute(context);
    } });
  } });
  try {
    const result = await boundary.exec('witness "$(raw)"');
    assert.equal(result.exitCode, 1);
    assert.equal(witnessed, true);
    assert.equal(result.stdout, "");
    // TextDecoder's fatal decoding message differs between V8 and workerd.
    assert.match(result.stderr, /not valid for encoding utf-8|Failed to decode input/);
  } finally { await boundary.dispose(); }

  const abort = new AbortController();
  let closed = false;
  const cancelled = new Shell({ fs: new MemoryFileSystem() }).use(llmCommands({
    defaultModel: "cancel", providers: [{ name: "test", models: [{ id: "cancel" }], async *complete() {
      try { abort.abort(); yield "late"; } finally { closed = true; }
    } }],
  }));
  try {
    await assert.rejects(cancelled.exec("llm hello", { signal: abort.signal }), error => error === abort.signal.reason);
    assert.equal(closed, true);
  } finally { await cancelled.dispose(); }

  const failure = new FsError("EACCES", "/denied");
  const failing = new Shell({ fs: new MemoryFileSystem() }).use(llmCommands({
    defaultModel: "failure", providers: [{ name: "test", models: [{ id: "failure" }], complete() { throw failure; } }],
  }));
  try {
    const result = await failing.exec("llm hello");
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /denied/);
  } finally { await failing.dispose(); }
}

async function verifyStreamedInputs() {
  const signal = new AbortController().signal;
  let disposed = 0, requests = 0;
  const source = text => ({
    bytes: { async *[Symbol.asyncIterator]() {
      for (const byte of new TextEncoder().encode(text)) yield Uint8Array.of(byte);
    } },
    async dispose() { disposed++; },
  });
  const provider = createOpenAiProvider({
    apiKey: "fixture", models: [
      { id: "embedding", endpoint: "embeddings" },
      { id: "chat", endpoint: "chat", attachmentTypes: ["audio/wav", "audio/mpeg", "application/pdf"] },
    ],
    async transport(request) {
      requests++;
      const decoder = new TextDecoder();
      let text = "";
      for await (const chunk of request.body) {
        if (chunk.length > 16384) throw new Error("Unbounded provider input chunk");
        text += decoder.decode(chunk, { stream: true });
      }
      const body = JSON.parse(text + decoder.decode());
      if (body.model === "embedding") {
        assert.equal(body.input[0], 'café 🦄\n"');
      } else {
        const parts = body.messages[0].content;
        assert.equal(parts[1].input_audio.data, "YWJj");
        assert.equal(parts[1].input_audio.format, "wav");
        assert.equal(parts[2].input_audio.data, "YWJj");
        assert.equal(parts[2].input_audio.format, "mp3");
        assert.equal(parts[3].file.file_data, "data:application/pdf;base64,YWJj");
        assert.equal(parts[3].file.filename, "5bea2091743e0b9949fa8d405bf621f4aeccb13a138dffe2835572a6ae6a84be.pdf");
      }
      return { status: 200, statusText: "OK", headers: [],
        body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(body.model === "embedding"
          ? '{"data":[{"index":0,"embedding":[1,2]}]}'
          : '{"choices":[{"message":{"content":"received"}}]}'); } },
        async dispose() {},
      };
    },
  });
  const service = createLlmService({ providers: [provider] });
  const embedded = await service.embedSources({ model: "embedding", inputs: [source('café 🦄\n"')], options: {}, signal });
  assert.equal(JSON.stringify(embedded.vectors), "[[1,2]]");
  assert.equal(disposed, 1);
  let downloads = 0, admitted = 0;
  const url = "https://example.test/a";
  const remote = createLlmUrlSource({ url, signal, maxBytes: 3,
    admitBytes(bytes) { admitted += bytes; },
    async fetch(input, init) {
      downloads++;
      assert.equal(input, url);
      assert.equal(init.redirect, "manual");
      return new Response("abc");
    },
  });
  assert.equal(downloads, 0);
  let output = "";
  for await (const event of service.streamSources({ model: "chat", prompt: source("read"), stream: false, options: {}, signal,
    attachments: [
      { mimeType: "audio/wav", source: source("abc") },
      { mimeType: "audio/mpeg", source: source("abc") },
      { mimeType: "application/pdf", source: remote, id: await getLlmAttachmentUrlId(url, signal) },
    ],
  })) if (event.type === "text") output += event.text;
  assert.equal(requests, 2);
  assert.equal(disposed, 4);
  assert.equal(downloads, 1);
  assert.equal(admitted, 3);
  assert.equal(output, "received");
  const tooLarge = createLlmUrlSource({ url, signal, maxBytes: 2, async fetch() { return new Response("abc"); } });
  try {
    await assert.rejects((async () => { for await (const chunk of tooLarge.bytes) void chunk; })(), error => error.code === "EFBIG");
  } finally { await tooLarge.dispose(); }
  const abort = new AbortController();
  const cancelled = createLlmUrlSource({ url, signal: abort.signal, async fetch() { throw new Error("Cancelled input must not fetch"); } });
  abort.abort(new Error("installed cancellation"));
  try {
    await assert.rejects((async () => { for await (const chunk of cancelled.bytes) void chunk; })(), error => error === abort.signal.reason);
  } finally { await cancelled.dispose(); }
}

export async function verifyLlmPluginDiagnostics() {
  const message = '界🐍'.repeat(5000) + ': complete native error';
  const loader = () => { throw new Error(message); };
  for (const [flag, kind] of [['-t', 'template'], ['-f', 'fragment']]) {
    let stderr = '', writes = 0;
    const command = createLlmCommand({
      templateLoaders: new Map([['native', loader]]), fragmentLoaders: new Map([['native', loader]]),
      defaultModel: 'fixture', providers: [{ name: 'fixture', models: [{ id: 'fixture' }], complete() { throw new Error('Unexpected provider execution'); } }],
    });
    const result = await command.execute({
      command: 'llm', args: [flag, 'native:value', 'question'], fs: new MemoryFileSystem(), cwd: '/', env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() { throw new Error('Unexpected stdout'); } },
      stderr: { async write(bytes) {
        if (bytes.length > 16384) throw new Error('Unbounded diagnostic write');
        stderr += new TextDecoder('utf-8', { fatal: true }).decode(bytes); writes++;
      } },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(stderr, `Error: Could not load ${kind} native:value: ${message}\n`);
    if (writes < 2) throw new Error('Missing complete native diagnostic');
  }
  return { pluginDiagnostics: true };
}
