import assert from "node:assert/strict";
import test from "node:test";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {toByteSource} from "safe-bash-contracts";
import {createLlmCommand} from "./command.js";
import {createLlmToolRegistry} from "./tool-registry.js";
import type {LlmRequest, LlmSourceRequest} from "./types.js";
import fixtures from "./fixtures/prompt-debug-0.27.1.json" with {type: "json"};

for (const source of [false, true]) for (const fixture of fixtures) test(`pinned tool debug source=${source}: ${fixture.name}`, async () => {
  const fs = new MemoryFileSystem(); let stdout = "", stderr = "", disposed = 0;
  const complete = async function* (request: LlmRequest | LlmSourceRequest) {
    if (!request.messages?.length) {yield "thinking"; return {toolCalls: [{name: "lookup", arguments: {q: "one"}, id: "id"}]};}
    yield "answer";
  };
  const command = createLlmCommand({
    tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, implementation() {
      if (fixture.name === "exception") throw new Error(fixture.value);
      return {output: fixture.value, ...(fixture.name === "attachment" ? {attachments: [
        {mimeType: "image/png", source: {bytes: toByteSource("abc"), async dispose() {disposed++;}}},
        {mimeType: "image/png", url: "https://example.test/a.png"}
      ]} : {})};
    }}]),
    providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["tools", "messages"], attachmentTypes: ["image/png"], attachmentUrls: true}], complete,
      ...(source ? {completeSources: complete} : {})}]
  });
  const result = await command.execute({command: "llm", args: ["hello", "-m", "fixture", "-T", "lookup", "--td"], fs, cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: toByteSource(""), stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
  });
  assert.deepEqual({stdout, stderr, exitCode: result.exitCode}, {stdout: fixture.stdout, stderr: fixture.stderr, exitCode: fixture.exitCode});
  assert.equal(disposed, fixture.name === "attachment" ? 1 : 0);
  assert.deepEqual(await fs.readdir("/"), []);
});

test("debug exceptions stream large Unicode messages in bounded writes", async () => {
  const fs = new MemoryFileSystem(); let maximum = 0, calls = 0;
  const message = "é😀".repeat(10000);
  const command = createLlmCommand({limits: {maxInputBytes: 1_000_000, maxBufferedInputBytes: 1024, maxOutputBytes: 1_000_000},
    tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, implementation() {throw new Error(message);}}]),
    providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["tools", "messages"]}], complete() {assert.fail("source path");},
      async *completeSources() {if (!calls++) return {toolCalls: [{name: "lookup", arguments: {}, id: "id"}]}; yield "done";}}]
  });
  const result = await command.execute({command: "llm", args: ["hello", "-m", "fixture", "-T", "lookup", "--tools-debug"], fs, cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: toByteSource(""), stdout: {async write() {}}, stderr: {async write(bytes) {maximum = Math.max(maximum, bytes.length);}}
  });
  assert.equal(result.exitCode, 0);
  assert.ok(maximum <= 16384, `debug wrote ${maximum} bytes at once`);
  assert.deepEqual(await fs.readdir("/"), []);
});

test("debug environment booleans use pinned validation and explicit flags take precedence", async () => {
  for (const [value, enabled] of [["", false], ["0", false], ["off", false], ["FALSE", false], ["true", true], [" YES ", true], ["\u001ctrue\u001c", true], ["bad", null]] as const) {
    for (const explicit of [false, true]) {
      let calls = 0, stderr = "";
      const command = createLlmCommand({
        tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, implementation: () => ({output: "done"})}]),
        providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["tools", "messages"]}], async *complete() {
          if (!calls++) return {toolCalls: [{name: "lookup", arguments: {}, id: "id"}]}; yield "answer";
        }}]
      });
      const result = await command.execute({command: "llm", args: ["hello", "-m", "fixture", "-T", "lookup", ...(explicit ? ["--td"] : [])], fs: new MemoryFileSystem(), cwd: "/", env: {LLM_TOOLS_DEBUG: value}, signal: new AbortController().signal,
        stdin: toByteSource(""), stdout: {async write() {}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
      });
      if (enabled === null && !explicit) {
        assert.equal(result.exitCode, 2); assert.equal(calls, 0);
        assert.equal(stderr, "Usage: llm prompt [OPTIONS] [PROMPT]\nTry 'llm prompt --help' for help.\n\nError: Invalid value for '--td' / '--tools-debug': 'bad' is not a valid boolean. Recognized values: , 0, 1, f, false, n, no, off, on, t, true, y, yes\n");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr.includes("Tool call:"), Boolean(enabled || explicit), JSON.stringify({value, explicit}));
      }
    }
  }
});

test("a rejected debug sink stops the chain, preserves the failure and closes tool sources", async () => {
  const fs = new MemoryFileSystem(), failure = new Error("debug sink closed"); let calls = 0, disposed = 0;
  const command = createLlmCommand({
    tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, implementation: () => ({source: {bytes: toByteSource("done"), async dispose() {disposed++;}}})}]),
    providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["tools", "messages"]}], async *complete() {
      calls++; yield "thinking"; return {toolCalls: [{name: "lookup", arguments: {}, id: "id"}]};
    }}]
  });
  await assert.rejects(Promise.resolve(command.execute({command: "llm", args: ["hello", "-m", "fixture", "-T", "lookup", "--td"], fs, cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: toByteSource(""), stdout: {async write() {}}, stderr: {async write() {throw failure;}}
  })), error => error === failure);
  assert.equal(calls, 1); assert.equal(disposed, 1);
  assert.deepEqual(await fs.readdir("/"), []);
});

test("large JSON result diagnostics stream under source and aggregate output budgets", async () => {
  for (const limit of [1_000_000, 100]) {
    const fs = new MemoryFileSystem(); let calls = 0, disposed = 0, maximum = 0, diagnosticBytes = 0;
    const command = createLlmCommand({limits: {maxInputBytes: 1_000_000, maxBufferedInputBytes: 1024, maxOutputBytes: limit},
      tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, implementation: () => ({source: {
        bytes: {async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode('{"value":"');
          const chunk = new Uint8Array(4096).fill(120);
          for (let index = 0; index < 16; index++) yield chunk;
          yield new TextEncoder().encode('"}');
        }}, async dispose() {disposed++;}
      }})}]),
      providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["tools", "messages"]}], complete() {assert.fail("source path");},
        async *completeSources() {if (!calls++) return {toolCalls: [{name: "lookup", arguments: {}, id: "id"}]}; yield "done";}}]
    });
    const result = await command.execute({command: "llm", args: ["hello", "-m", "fixture", "-T", "lookup", "--td"], fs, cwd: "/", env: {}, signal: new AbortController().signal,
      stdin: toByteSource(""), stdout: {async write() {}}, stderr: {async write(bytes) {diagnosticBytes += bytes.length; maximum = Math.max(maximum, bytes.length);}}
    });
    assert.equal(result.exitCode, limit === 100 ? 1 : 0);
    assert.equal(calls, limit === 100 ? 1 : 2);
    assert.equal(disposed, 1); assert.ok(maximum <= 16384);
    if (limit > 100) assert.equal(diagnosticBytes, 65536 + '\nTool call: lookup({})\n  {\n    "value": ""\n  }\n\n'.length);
    assert.deepEqual(await fs.readdir("/"), []);
  }
});
