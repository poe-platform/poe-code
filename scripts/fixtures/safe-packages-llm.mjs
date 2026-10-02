import assert from "node:assert/strict";
import { CommandRegistry, commandRuntimeIdentity, getCommandArguments } from "@poe-platform/safe-bash/contracts/command";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";
import { Shell, FsError as rootFsError, MemoryFileSystem, agentCommands, createLlmService as rootService, llmCommands as rootPlugin, createOpenAiProvider as rootOpenAi, createElevenLabsProvider as rootElevenLabs } from "@poe-platform/safe-bash";
import { llmCommands, createLlmService, createLlmCommand } from "@poe-platform/safe-bash/commands/llm";
import { createOpenAiProvider, createElevenLabsProvider } from "@poe-platform/safe-bash/commands/llm/providers";

export async function verifyLlmCommands() {
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
    assert.match(result.stderr, /not valid for encoding utf-8/);
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
