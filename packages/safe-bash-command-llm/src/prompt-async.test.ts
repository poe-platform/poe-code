import assert from "node:assert/strict";
import test from "node:test";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {toByteSource, type CommandContext} from "safe-bash-contracts";
import {createLlmCommand} from "./command.js";
import {createLlmToolRegistry} from "./tool-registry.js";
import {createLlmService} from "./service.js";
import {createOpenAiProvider} from "./openai.js";
import type {LlmCommandsOptions, LlmInputSource, LlmRequest, LlmSourceRequest} from "./types.js";
import fixtures from "./fixtures/prompt-async-0.27.1.json" with {type: "json"};

async function read(value: string | LlmInputSource): Promise<string> {
  if (typeof value === "string") return value;
  let text = ""; const decoder = new TextDecoder();
  for await (const bytes of value.bytes) text += decoder.decode(bytes, {stream: true});
  return text + decoder.decode();
}
async function run(args: string[], options: LlmCommandsOptions, overrides: Partial<CommandContext> = {}) {
  let stdout = "", stderr = ""; const fs = new MemoryFileSystem();
  const result = await createLlmCommand(options).execute({command: "llm", args, fs, cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: toByteSource("yes\nno\n"), shellPredicates: {terminal: fd => fd === 0, variable: () => false, reference: () => false, option: () => false},
    stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}, ...overrides
  });
  assert.deepEqual(await fs.readdir("/"), []);
  return {stdout, stderr, exitCode: result.exitCode};
}

// llm 0.27.1, deterministic AsyncModel; terminal echo is owned by the terminal,
// so the oracle input primitive prints the prompt and reads without echoing.
for (const fixture of fixtures) for (const source of [false, true]) test(`pinned async prompt stream=${fixture.canStream} source=${source}: ${fixture.argv.join(" ")}`, async () => {
  const complete = async function* (request: LlmRequest | LlmSourceRequest) {
    assert.equal(request.async, true);
    assert.equal(request.stream, fixture.canStream && !fixture.argv.includes("--no-stream"));
    if (!request.tools?.length) {yield "plain:" + (request.options.count ?? 1); return;}
    const results = request.messages?.filter(message => message.role === "tool") ?? [];
    if (results.length) {yield (await Promise.all(results.map(result => read(result.content)))).join(","); return;}
    yield "thinking";
    return {toolCalls: [0,1].map(n => ({id: String(n), name: "lookup", arguments: {n}}))};
  };
  const result = await run(fixture.argv, {
    providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["messages"], asyncModel: {canStream: fixture.canStream, capabilities: ["messages", "tools", "schema"], options: {count: {type: "integer"}}}}, {id: "sync"}], complete, ...(source ? {completeSources: complete} : {})}],
    tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, async: true, async implementation(args) {return {output: "done" + args.n};}}])
  });
  assert.deepEqual(result, {stdout: fixture.stdout, stderr: fixture.stderr, exitCode: fixture.exitCode});
});

for (const source of [false,true]) test(`async CLI restores result and attachment order source=${source}`, async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
  let rounds = 0, disposed = 0;
  const complete = async function* (request: LlmRequest | LlmSourceRequest) {
    assert.equal(request.async, true);
    if (++rounds === 1) {yield "thinking"; return {toolCalls: [0,1].map(n => ({id: String(n), name: "lookup", arguments: {n}}))};}
    const results = request.messages!.filter(message => message.role === "tool");
    assert.deepEqual(results.map(message => message.toolCallId), ["0", "1"]);
    assert.deepEqual(await Promise.all(results.map(message => read(message.content))), ["done0", "done1"]);
    const attachments = [];
    for (const attachment of request.attachments) {
      if ("bytes" in attachment) attachments.push([...attachment.bytes!]);
      else {const value: number[] = []; if ("source" in attachment) for await (const bytes of attachment.source!.bytes) value.push(...bytes); attachments.push(value);}
    }
    assert.deepEqual(attachments, [[0], [1]]); yield "done";
  };
  const result = await run(["hello", "--async", "-m", "fixture", "-T", "lookup", "--td"], {
    providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["messages", "tools"], attachmentTypes: ["image/png"], asyncModel: {}}], complete, ...(source ? {completeSources: complete} : {})}],
    tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, async: true, async implementation(args) {
      const n = Number(args.n); if (!n) await gate;
      return {output: "done" + n, attachments: [{mimeType: "image/png", source: {bytes: toByteSource(Uint8Array.of(n)), async dispose() {disposed++; if (n) release();}}}]};
    }}])
  });
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(rounds, 2); assert.equal(disposed, 2);
  assert.equal(result.stdout, "thinkingdone\n");
  assert.equal(result.stderr.split("Tool call:").length, 3);
});

test("SDK cannot force streaming on a nonstreaming async model", async () => {
  const complete = async function* (request: LlmRequest | LlmSourceRequest) {assert.equal(request.stream, false); yield "done";};
  const service = createLlmService({providers: [{name: "fixture", models: [{id: "fixture", asyncModel: {canStream: false}}], complete, completeSources: complete}]});
  for await (const ignored of service.stream({model: "fixture", async: true, stream: true, prompt: "hello", attachments: [], options: {}, signal: new AbortController().signal})) void ignored;
  for await (const ignored of service.streamSources!({model: "fixture", async: true, stream: true, prompt: {bytes: toByteSource("hello"), async dispose() {}}, attachments: [], options: {}, signal: new AbortController().signal})) void ignored;
});

test("OpenAI chat exposes async mode through the existing injected transport", async () => {
  let requests = 0;
  const provider = createOpenAiProvider({apiKey: "fixture", models: [{id: "fixture", endpoint: "chat"}], transport: async request => {
    requests++; let body = ""; for await (const bytes of request.body!) body += new TextDecoder().decode(bytes);
    assert.equal(JSON.parse(body).stream, false);
    return {status: 200, statusText: "OK", headers: [], body: toByteSource(JSON.stringify({choices: [{message: {content: "done"}}]})), async dispose() {}};
  }});
  const result = await run(["hello", "-m", "fixture", "--async", "--no-stream"], {providers: [provider]});
  assert.deepEqual(result, {stdout: "done\n", stderr: "", exitCode: 0}); assert.equal(requests, 1);
});

test("declining the first async call does not implicitly decline the second", async () => {
  const executed: number[] = [];
  const result = await run(["hello", "--async", "-m", "fixture", "-T", "lookup", "--ta"], {
    providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["messages", "tools"], asyncModel: {}}], async *complete(request) {
      const results = request.messages?.filter(message => message.role === "tool");
      if (results?.length) {yield results.map(result => result.content).join(","); return;}
      return {toolCalls: [0,1].map(n => ({id: String(n), name: "lookup", arguments: {n}}))};
    }}], tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, async: true, async implementation(args) {executed.push(Number(args.n)); return {output: "done" + args.n};}}])
  }, {stdin: toByteSource("no\nyes\n")});
  assert.equal(result.exitCode, 0, result.stderr); assert.deepEqual(executed, [1]);
  assert.equal(result.stdout, "Approve tool call? [y/N]: Approve tool call? [y/N]: Cancelled: User cancelled tool call,done1\n");
});

test("async source chains stage large results under a small materialized-input limit", async () => {
  let disposed = 0, total = 0;
  const result = await run(["hello", "--async", "-m", "fixture", "-T", "lookup"], {
    limits: {maxInputBytes: 3 * 1024 * 1024, maxBufferedInputBytes: 1024},
    providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["messages", "tools"], asyncModel: {}}], complete() {assert.fail("source transport required");}, async *completeSources(request) {
      const results = request.messages?.filter(message => message.role === "tool") ?? [];
      if (results.length) {
        for (const result of results) for await (const bytes of result.content.bytes) {assert.ok(bytes.length <= 16384); total += bytes.length;}
        yield "done"; return;
      }
      return {toolCalls: [0,1].map(n => ({id: String(n), name: "lookup", arguments: {n}}))};
    }}], tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, async: true, async implementation() {
      return {source: {bytes: {async *[Symbol.asyncIterator]() {for (let i = 0; i < 64; i++) yield new Uint8Array(16384).fill(120);}}, async dispose() {disposed++;}}};
    }}])
  });
  assert.deepEqual(result, {stdout: "done\n", stderr: "", exitCode: 0});
  assert.equal(total, 2 * 1024 * 1024); assert.equal(disposed, 2);
});

test("async debug sink failure cancels a sibling source and preserves sink identity", async () => {
  const failure = new Error("debug sink failed"), fs = new MemoryFileSystem();
  let reading!: () => void; const started = new Promise<void>(resolve => {reading = resolve;});
  let disposed = 0;
  await assert.rejects(run(["hello", "--async", "-m", "fixture", "-T", "lookup", "--td"], {
    providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["messages", "tools"], asyncModel: {}}], complete() {assert.fail("source transport required");}, async *completeSources() {
      yield "thinking"; return {toolCalls: [0,1].map(n => ({id: String(n), name: "lookup", arguments: {n}}))};
    }}], tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, async: true, async implementation(args) {
      if (args.n === 1) {await started; return {output: "done"};}
      return {source: {bytes: {async *[Symbol.asyncIterator]() {reading(); await new Promise<void>(() => {}); yield new Uint8Array();}}, async dispose() {disposed++;}}};
    }}])
  }, {fs, stderr: {async write() {throw failure;}}}), error => error === failure);
  assert.equal(disposed, 1); assert.deepEqual(await fs.readdir("/"), []);
});

for (const failure of [new Error("overlapping debug failure"), undefined, null, 0]) test(`overlapping approval stdout preserves debug failure ${String(failure)}`, async () => {
  let debugStarted!: () => void, approvalFinished!: () => void;
  const debug = new Promise<void>(resolve => {debugStarted = resolve;});
  const approval = new Promise<void>(resolve => {approvalFinished = resolve;});
  let prompts = 0;
  await assert.rejects(run(["hello", "--async", "-m", "fixture", "-T", "lookup", "--ta", "--td"], {
    providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["messages", "tools"], asyncModel: {}}], async *complete() {
      yield ""; return {toolCalls: [0,1].map(n => ({id: String(n), name: "lookup", arguments: {n}}))};
    }}], tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, async: true, async implementation() {return {output: "done"};}}])
  }, {stdout: {async write(bytes) {
    if (new TextDecoder().decode(bytes).includes("Approve tool call") && ++prompts === 2) {await debug; approvalFinished();}
  }}, stderr: {async write(bytes) {
    if (new TextDecoder().decode(bytes).startsWith("\nTool call:")) {debugStarted(); await approval; throw failure;}
  }}}), error => error === failure);
});
