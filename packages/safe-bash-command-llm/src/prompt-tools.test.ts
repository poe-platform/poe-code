import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createLlmCommand } from "./command.js";
import { createLlmToolRegistry } from "./tool-registry.js";
import type { LlmRequest, LlmSourceRequest, LlmCommandsOptions, LlmInputSource } from "./types.js";
import fixtures from "./fixtures/prompt-tools-0.27.1.json" with {type: "json"};
import wireFixture from "./fixtures/prompt-tool-wire-0.27.1.json" with {type: "json"};
import { createOpenAiProvider } from "./openai.js";
import { toByteSource } from "safe-bash-contracts";

for (const fixture of fixtures) for (const source of [false, true])
  test(`pinned prompt tools ${source ? "source" : "buffered"}: ${fixture.argv.join(" ")}`, async () => {
    let stdout = "", stderr = "";
    const complete = async function* (request: LlmRequest | LlmSourceRequest) {
      if (!request.tools?.length) {yield "plain"; return;}
      const result = request.messages?.find(message => message.role === "tool");
      if (result) {
        let content = "";
        if (typeof result.content === "string") content = result.content;
        else for await (const bytes of result.content.bytes) content += new TextDecoder().decode(bytes);
        yield "answer:" + content; return;
      }
      yield "thinking";
      return {toolCalls: [{name: "lookup", arguments: {query: "one"}, id: "id"}]};
    };
    const command = createLlmCommand({providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["tools", "messages"]}], complete,
      ...(source ? {completeSources: complete} : {})}],
      tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, implementation: args => ({output: "found " + args.query})}])
    });
    const fs = new MemoryFileSystem();
    const result = await command.execute({command: "llm", args: fixture.argv, fs, cwd: "/", env: {}, signal: new AbortController().signal,
      stdin: {async *[Symbol.asyncIterator]() {}},
      stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}},
      stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
    });
    assert.deepEqual({stdout, stderr, exitCode: result.exitCode}, {stdout: fixture.stdout, stderr: fixture.stderr, exitCode: fixture.exitCode});
    assert.deepEqual(await fs.readdir("/"), []);
  });

async function run(args: string[], options: LlmCommandsOptions, fs = new MemoryFileSystem(), signal = new AbortController().signal) {
  let stdout = "", stderr = "";
  const result = await createLlmCommand(options).execute({command: "llm", args, fs, cwd: "/", env: {}, signal,
    stdin: {async *[Symbol.asyncIterator]() {}},
    stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
  });
  return {...result, stdout, stderr};
}
async function read(source: LlmInputSource): Promise<string> {
  const decoder = new TextDecoder("utf-8", {fatal: true}); let text = "";
  for await (const bytes of source.bytes) text += decoder.decode(bytes, {stream: true});
  return text + decoder.decode();
}

test("CLI accepts arbitrary Python chain-limit integers without rounding", async () => {
  for (const limit of ["9007199254740993", "١_٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠", "+000000000000000000000000", "-9007199254740993"]) {
    let executed = 0;
    const result = await run(["hello", "-m", "fixture", "-T", "lookup", "--cl", limit], {
      tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, implementation() {executed++; return {output: "done"};}}]),
      providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["tools", "messages"]}], async *complete(request) {
        yield "step";
        return request.messages?.length ? {} : {toolCalls: [{name: "lookup", arguments: {}, id: "id"}]};
      }}]
    });
    const negative = limit.startsWith("-");
    assert.equal(result.exitCode, negative ? 1 : 0, result.stderr);
    assert.equal(result.stderr, negative ? "Error: Chain limit of -9007199254740993 exceeded.\n" : "");
    assert.equal(executed, negative ? 0 : 1);
    assert.equal(result.stdout, negative ? "step" : "stepstep\n");
  }
});

test("three source rounds preserve pinned system, prompt, call and current-attachment ordering", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", new Uint8Array([1,2,3]));
  const seen: unknown[] = [];
  let calls = 0, disposed = 0;
  const result = await run(["hello", "-m", "fixture", "-s", "system", "--schema", "{\"type\":\"object\"}", "--at", "/input.png", "image/png", "-T", "lookup"], {
    tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, implementation(args, context) {
      assert.equal(context.fs, fs); assert.equal(context.cwd, "/");
      return {output: "found " + args.round, attachments: [{mimeType: "image/png", source: {bytes: {async *[Symbol.asyncIterator]() {yield Uint8Array.of(9);}}, async dispose() {disposed++;}}}]};
    }}]),
    providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["tools", "messages", "schema"], attachmentTypes: ["image/png"]}],
      complete() {assert.fail("must stream sources");},
      async *completeSources(request) {
        const attachments = async (values: LlmSourceRequest["attachments"]) => {
          const result: number[][] = [];
          for (const attachment of values) {const bytes: number[] = []; for await (const chunk of attachment.source!.bytes) bytes.push(...chunk); result.push(bytes);}
          return result;
        };
        const messages = [];
        for (const message of request.messages ?? []) messages.push({role: message.role, text: await read(message.content),
          ...(message.toolCalls ? {calls: message.toolCalls} : {}), ...(message.toolCallId ? {id: message.toolCallId} : {}),
          ...(message.attachments?.length ? {attachments: await attachments(message.attachments)} : {})});
        seen.push({prompt: await read(request.prompt), system: request.system ? await read(request.system) : undefined,
          schema: request.schema, messages, attachments: await attachments(request.attachments)});
        calls++;
        if (calls === 3) {yield "done"; return;}
        yield "think\ud83d"; yield "\ude00";
        return {toolCalls: [{name: "lookup", arguments: {round: calls}, id: String(calls)}]};
      }
    }]
  }, fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "think😀think😀done\n");
  const first = {role: "assistant", text: "", calls: [{name: "lookup", arguments: {round: 1}, id: "1"}]};
  const context = [{role: "system", text: "system"}, {role: "user", text: "hello"}, {role: "assistant", text: "think😀"}, first, {role: "tool", text: "found 1", id: "1"}];
  assert.deepEqual(seen, [
    {prompt: "hello", system: "system", schema: {type: "object"}, messages: [], attachments: [[1,2,3]]},
    {prompt: "", system: undefined, schema: undefined, messages: context, attachments: [[9]]},
    {prompt: "", system: undefined, schema: undefined, messages: [...context, {role: "assistant", text: "think😀"},
      {role: "assistant", text: "", calls: [{name: "lookup", arguments: {round: 2}, id: "2"}]}, {role: "tool", text: "found 2", id: "2"}], attachments: [[9]]}
  ]);
  assert.equal(disposed, 2);
  assert.deepEqual(await fs.readdir("/"), [{name: "input.png", type: "file"}]);
});

test("CLI live chain wire matches pinned OpenAI attachment and assistant message behavior", async () => {
  const fs = new MemoryFileSystem(); await fs.writeFile("/input.png", Uint8Array.of(1,2,3));
  const requests: unknown[] = [];
  const provider = createOpenAiProvider({apiKey: "fixture", models: [{id: "fixture", endpoint: "chat", capabilities: ["messages", "tools", "schema"], attachmentTypes: ["image/png"]}],
    transport: async request => {
      let body = ""; for await (const bytes of request.body!) body += new TextDecoder().decode(bytes);
      requests.push(JSON.parse(body).messages);
      const round = requests.length;
      const message = {content: round === 3 ? "done" : "think😀", ...(round === 3 ? {} : {tool_calls: [{id: String(round), type: "function", function: {name: "lookup", arguments: JSON.stringify({round})}}]})};
      return {status: 200, statusText: "OK", headers: [], body: toByteSource(JSON.stringify({choices: [{message}]})), async dispose() {}};
    }
  });
  const result = await run(["hello", "-m", "fixture", "-s", "system", "--at", "/input.png", "image/png", "--no-stream", "-T", "lookup"], {
    providers: [provider], tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, implementation: args => ({
      output: "found " + args.round, attachments: [{mimeType: "image/png", source: {bytes: toByteSource(Uint8Array.of(9)), async dispose() {}}}]
    })}])
  }, fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, wireFixture.text + "\n");
  assert.deepEqual(requests, wireFixture.requests);
});

test("large tool results stream through caller staging without materialized-input admission", async () => {
  const fs = new MemoryFileSystem(); let calls = 0, released = 0, readBytes = 0, maximum = 0;
  const result = await run(["hello", "-m", "fixture", "-T", "lookup"], {
    limits: {maxInputBytes: 2_000_000, maxBufferedInputBytes: 1024, maxOutputBytes: 1000},
    tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, implementation: () => ({source: {
      bytes: {async *[Symbol.asyncIterator]() {for (let index = 0; index < 64; index++) yield new Uint8Array(16384).fill(120);}},
      async dispose() {released++;}
    }})}]),
    providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["tools", "messages"]}], complete() {assert.fail("buffered path");},
      async *completeSources(request) {
        if (!calls++) return {toolCalls: [{name: "lookup", arguments: {}, id: "id"}]};
        for (const message of request.messages ?? []) if (message.role === "tool") for await (const bytes of message.content.bytes) {readBytes += bytes.length; maximum = Math.max(maximum, bytes.length);}
        yield "done";
      }
    }]
  }, fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "done\n");
  assert.equal(readBytes, 1_048_576);
  assert.ok(maximum <= 16384);
  assert.equal(released, 1);
  assert.deepEqual(await fs.readdir("/"), []);
});

test("tool input overflow stops before a second provider call and cleans staging", async () => {
  const fs = new MemoryFileSystem(); let calls = 0;
  const result = await run(["hello", "-m", "fixture", "-T", "lookup"], {
    limits: {maxInputBytes: 512},
    tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, implementation: () => ({output: "x".repeat(1024)})}]),
    providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["tools", "messages"]}], async *complete() {
      calls++; yield ""; return {toolCalls: [{name: "lookup", arguments: {}}]};
    }}]
  }, fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /byte limit exceeded/);
  assert.equal(calls, 1);
  assert.deepEqual(await fs.readdir("/"), []);
});

test("cancellation during a tool read retires its source and every command spool", async () => {
  const fs = new MemoryFileSystem(), controller = new AbortController(); let released = 0;
  let started!: () => void; const ready = new Promise<void>(resolve => {started = resolve;});
  const running = run(["hello", "-m", "fixture", "-T", "lookup"], {
    tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}, implementation: () => ({source: {
      bytes: {[Symbol.asyncIterator]() {return {next() {started(); return new Promise<IteratorResult<Uint8Array>>(() => {});}};}},
      async dispose() {released++;}
    }})}]),
    providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["tools", "messages"]}], async *complete() {
      yield ""; return {toolCalls: [{name: "lookup", arguments: {}}]};
    }}]
  }, fs, controller.signal);
  await ready; controller.abort(new Error("cancel tool read"));
  await assert.rejects(running, {message: "cancel tool read"});
  assert.equal(released, 1);
  assert.deepEqual(await fs.readdir("/"), []);
});

test("saved template tool names are resolved when the template is invoked", async () => {
  const fs = new MemoryFileSystem(); let dispatched = 0;
  const options: LlmCommandsOptions = {
    tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}}]),
    providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["tools"]}], async *complete(request) {
      dispatched++; assert.equal(request.tools?.[0]?.name, "lookup"); yield "done";
    }}]
  };
  assert.equal((await run(["hello", "-m", "fixture", "-T", "lookup", "--save", "saved"], options, fs)).exitCode, 0);
  assert.equal(dispatched, 0);
  const result = await run(["-t", "saved"], options, fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(dispatched, 1);
  assert.equal(result.stdout, "done\n");
});

for (const source of [false, true]) test(`tool prompts compose file fragments before chaining, source=${source}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/fragment", new TextEncoder().encode("piece"));
  await fs.writeFile("/system", new TextEncoder().encode("instructions"));
  const complete = async function* (request: LlmRequest | LlmSourceRequest) {
    assert.equal(typeof request.prompt === "string" ? request.prompt : await read(request.prompt), "piece\ntail");
    assert.equal(typeof request.system === "string" ? request.system : await read(request.system!), "instructions");
    yield "done";
  };
  const result = await run(["tail", "-m", "fixture", "-f", "/fragment", "--sf", "/system", "-T", "lookup"], {
    tools: createLlmToolRegistry([{name: "lookup", inputSchema: {}}]),
    providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["tools"]}], complete, ...(source ? {completeSources: complete} : {})}]
  }, fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "done\n");
});
