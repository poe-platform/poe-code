import assert from "node:assert/strict";
import test from "node:test";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {toByteSource, type CommandContext} from "safe-bash-contracts";
import {createLlmCommand} from "./command.js";
import {createLlmToolRegistry} from "./tool-registry.js";
import {waitForSource} from "./request-source.js";
import type {LlmRequest, LlmSourceRequest} from "./types.js";
import fixtures from "./fixtures/prompt-approval-0.27.1.json" with {type: "json"};

async function run(input: string, source: boolean, overrides: Partial<CommandContext> = {}, flags = ["--ta", "--no-stream"], calls = 1) {
  const fs = new MemoryFileSystem(); let stdout = "", stderr = "", executions = 0;
  const complete = async function* (request: LlmRequest | LlmSourceRequest) {
    const result = request.messages?.find(message => message.role === "tool");
    if (!result) {yield "thinking"; return {toolCalls: Array.from({length: calls}, (_, index) => ({name: "lookup", arguments: {q: "one"}, id: String(index)}))};}
    let output = "";
    if (typeof result.content === "string") output = result.content;
    else for await (const bytes of result.content.bytes) output += new TextDecoder().decode(bytes);
    yield "answer:" + output;
  };
  const result = await createLlmCommand({
    tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, implementation(args) {executions++; return {output: "found " + args.q};}}]),
    providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["messages", "tools"]}], complete, ...(source ? {completeSources: complete} : {})}]
  }).execute({command: "llm", args: ["hello", "-m", "fixture", "-T", "lookup", ...flags], cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(input),
    shellPredicates: {terminal: fd => fd === 0, variable: () => false, reference: () => false, option: () => false},
    stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}, ...overrides
  });
  assert.deepEqual(await fs.readdir("/"), []);
  return {stdout, stderr, exitCode: result.exitCode, executions};
}

for (const source of [false, true]) for (const fixture of fixtures) test(`pinned approval source=${source} input=${JSON.stringify(fixture.input)}`, async () => {
  const {executions, ...result} = await run(fixture.input, source);
  assert.deepEqual(result, {stdout: fixture.stdout, stderr: fixture.stderr, exitCode: fixture.exitCode});
  assert.equal(executions, fixture.stdout.includes("found one") ? 1 : 0);
});

test("streamed approval follows the already emitted response", async () => {
  const result = await run("y\n", true, {}, ["--tools-approve"]);
  assert.equal(result.stdout, "thinkingApprove tool call? [y/N]: answer:found one\n");
  assert.equal(result.executions, 1);
});

test("approval consumes descriptor stdin instead of reopening its iterable", async () => {
  const input = new TextEncoder().encode("y\n"); let position = 0;
  const result = await run("", true, {
    stdin: {[Symbol.asyncIterator]() {assert.fail("descriptor stdin must own reads");}},
    stdinInput: {get position() {return position;}, async read(maxBytes) {
      if (position === input.length) return {done: true, value: undefined};
      const bytes = input.slice(position, position + maxBytes); position += bytes.length;
      return {done: false, value: bytes};
    }}
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.executions, 1);
});

test("approval waits remain cancellable and retire pending stdin", async () => {
  const controller = new AbortController(); let closed = 0;
  await assert.rejects(run("", true, {signal: controller.signal, stdin: {[Symbol.asyncIterator]() {return {
    next() {queueMicrotask(() => controller.abort(new Error("stop approval"))); return new Promise(() => {});},
    async return() {closed++; return {done: true, value: undefined};}
  };}}}), {message: "stop approval"});
  assert.equal(closed, 1);
});

test("approval strips arbitrarily long whitespace without retaining a whole line", async () => {
  const result = await run("", true, {stdin: {async *[Symbol.asyncIterator]() {
    for (let i = 0; i < 128; i++) yield new Uint8Array(8192).fill(32);
    yield new TextEncoder().encode("YES\n");
  }}});
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.executions, 1);
});

test("approval input is charged before an implementation can run", async () => {
  const result = await run(" ".repeat(1024) + "y\n", true, {inputBudget: {maxBytes: 512, check(size) {if (size > 512) throw new Error("input quota");}}});
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /input quota/);
  assert.match(result.stderr, /Tool call: lookup/);
  assert.equal(result.executions, 0);
});

test("each call requires its own approval, including calls in the same response", async () => {
  const result = await run("yes\nno\n", true, {}, ["--ta", "--no-stream"], 2);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.executions, 1);
  assert.equal(result.stdout, "Approve tool call? [y/N]: Approve tool call? [y/N]: thinkinganswer:found one\n");
  assert.equal(result.stderr, "Tool call: lookup({'q': 'one'})\nTool call: lookup({'q': 'one'})\n");
});

test("approval recognizes universal newlines across input chunks", async () => {
  for (const separator of ["\r", "\r\n"]) {
    const result = await run("", true, {stdin: {async *[Symbol.asyncIterator]() {
      for (const byte of new TextEncoder().encode("yes" + separator + "no" + separator)) yield Uint8Array.of(byte);
    }}}, ["--ta"], 2);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.executions, 1);
    assert.equal(result.stdout, "thinkingApprove tool call? [y/N]: Approve tool call? [y/N]: answer:found one\n");
  }
});

test("redirected prompt stdin cannot be reused as an approval", async () => {
  const result = await run("yes\n", true, {shellPredicates: {terminal: () => false, variable: () => false, reference: () => false, option: () => false}});
  assert.equal(result.exitCode, 1);
  assert.equal(result.executions, 0);
  assert.equal(result.stdout, "Approve tool call? [y/N]: ");
});

test("cancellation retires an async generator after its read responds to the signal", async () => {
  const controller = new AbortController(); let closed = 0;
  await assert.rejects(run("", true, {signal: controller.signal, stdin: {async *[Symbol.asyncIterator]() {
    try {
      queueMicrotask(() => controller.abort(new Error("pending generator")));
      yield await waitForSource(() => new Promise<Uint8Array>(() => {}), controller.signal);
    } finally {closed++;}
  }}}), {message: "pending generator"});
  assert.equal(closed, 1);
});

test("completed approval waits for stdin cleanup before returning", async () => {
  let entered!: () => void, release!: () => void, settled = false, read = false;
  const closing = new Promise<void>(resolve => {entered = resolve;});
  const cleanup = new Promise<void>(resolve => {release = resolve;});
  const execution = run("", true, {stdin: {[Symbol.asyncIterator]() {return {
    async next() {if (read) return {done: true, value: undefined}; read = true; return {done: false, value: new TextEncoder().encode("yes\n")};},
    async return() {entered(); await cleanup; return {done: true, value: undefined};}
  };}}}).then(result => {settled = true; return result;});
  await closing;
  await new Promise<void>(resolve => {setImmediate(resolve);});
  try {assert.equal(settled, false);} finally {release(); await execution;}
});
