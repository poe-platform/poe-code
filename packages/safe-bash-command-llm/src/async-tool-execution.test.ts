import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { executeLlmToolCalls, LlmCancelToolCall, type LlmExecutableTool } from "./tool-execution.js";
import { streamLlmToolChain } from "./tool-chain.js";
import fixtures from "./fixtures/async-tool-execution-0.27.1.json" with {type: "json"};

const context = () => ({fs: new MemoryFileSystem(), cwd: "/", signal: new AbortController().signal});
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
}

for (const fixture of fixtures) test(`pinned async tool results: ${fixture.mode}`, async () => {
  const events: unknown[][] = [], results: {id: string | undefined; output: string; exception: string | null}[] = [];
  const gate = deferred();
  const implementation: NonNullable<LlmExecutableTool["implementation"]> = async args => {
    events.push(["start", args.n]);
    if (fixture.mode === "parallel") {
      if (args.n === 0) await gate.promise;
      else gate.resolve();
    }
    if (fixture.mode === "failure") throw new Error("broken");
    events.push(["end", args.n]);
    return {output: "done " + args.n};
  };
  const tools: LlmExecutableTool[] = [{name: "lookup", inputSchema: {}, async: true,
    ...(fixture.mode === "no_implementation" ? {} : {implementation})}];
  if (fixture.mode === "duplicate") tools.push({name: "lookup", inputSchema: {}, async: true, implementation: async () => ({output: "last"})});
  await executeLlmToolCalls({async: true, tools, context: context(),
    calls: [0,1].map(n => ({id: String(n), name: fixture.mode === "missing" && n === 0 ? "absent" : "lookup", arguments: {n}})),
    beforeCall(_tool, call) {
      events.push(["before", Number(call.id)]);
      if (fixture.mode === "cancel") throw new LlmCancelToolCall("declined");
    }
  }, async (result, index) => {
    let output = "";
    for await (const bytes of result.output.bytes) output += new TextDecoder().decode(bytes);
    if (result.executed) events.push(["after", Number(result.call.id), output]);
    results[index] = {id: result.call.id, output, exception: result.exception instanceof Error ? result.exception.message : null};
  });
  assert.deepEqual(results.filter(Boolean), fixture.results);
  // Source visitors suspend while consuming bytes. Compare each call's lifecycle
  // independently of unrelated JavaScript/Python event-loop scheduling turns.
  for (const n of [0,1]) assert.deepEqual(events.filter(event => event[1] === n), fixture.events.filter(event => event[1] === n));
  if (fixture.mode === "parallel") assert.ok(events.findIndex(e => e[0] === "end" && e[1] === 1) < events.findIndex(e => e[0] === "end" && e[1] === 0));
});

test("async mode reports completion indices without retaining result payloads", async () => {
  const gate = deferred(), complete: number[] = [], disposed: number[] = [];
  await executeLlmToolCalls({async: true, context: context(), calls: [0,1].map(n => ({name: "run", arguments: {n}})),
    tools: [{name: "run", inputSchema: {}, async: true, async implementation(args) {
      const n = Number(args.n);
      if (!n) await gate.promise;
      return {source: {bytes: toByteSource("done"), async dispose() {disposed.push(n);}}};
    }}]
  }, async (result, index) => {
    for await (const bytes of result.output.bytes) assert.equal(new TextDecoder().decode(bytes), "done");
    complete.push(index);
    if (index === 1) gate.resolve();
  });
  assert.deepEqual(complete, [1,0]); assert.deepEqual(disposed.sort(), [0,1]);
});

test("promise-returning synchronous tools remain serial in async mode", async () => {
  let active = 0;
  await executeLlmToolCalls({async: true, context: context(), calls: [0,1].map(n => ({name: "run", arguments: {n}})),
    tools: [{name: "run", inputSchema: {}, implementation() {
      assert.equal(active++, 0);
      return Promise.resolve({output: "done"});
    }}]
  }, async result => {for await (const ignored of result.output.bytes) void ignored; active--;});
  assert.equal(active, 0);
});

test("async visitor failure cancels siblings, preserves identity, and disposes late outputs", async () => {
  const ready = deferred(), late = deferred<{source: {bytes: AsyncIterable<Uint8Array>; dispose(): Promise<void>}}>();
  const failure = new Error("sink failed"); let disposed = 0, siblingSignal: AbortSignal | undefined;
  const execution = executeLlmToolCalls({async: true, context: context(), calls: [0,1].map(n => ({name: "run", arguments: {n}})),
    tools: [{name: "run", inputSchema: {}, async: true, async implementation(args, ctx) {
      if (args.n === 0) {siblingSignal = ctx.signal; ready.resolve(); return late.promise;}
      await ready.promise;
      return {output: "done"};
    }}]
  }, () => {throw failure;});
  await assert.rejects(execution, error => error === failure);
  assert.equal(siblingSignal?.aborted, true);
  const released = deferred();
  late.resolve({source: {bytes: toByteSource("late"), async dispose() {disposed++; released.resolve();}}});
  await released.promise;
  assert.equal(disposed, 1);
});

test("parallel outputs and attachments share aggregate admission", async () => {
  let disposed = 0, started = 0;
  const ready = deferred();
  const source = () => ({bytes: toByteSource("abc"), async dispose() {disposed++;}});
  await assert.rejects(executeLlmToolCalls({async: true, context: context(), maxOutputBytes: 8,
    calls: [0,1].map(n => ({name: "run", arguments: {n}})),
    tools: [{name: "run", inputSchema: {}, async: true, async implementation() {
      if (++started === 2) ready.resolve();
      await ready.promise;
      return {source: source(), attachments: [{mimeType: "text/plain", source: source()}]};
    }}]
  }, async result => {
    for await (const ignored of result.output.bytes) void ignored;
    for await (const ignored of result.attachments[0]!.source!.bytes) void ignored;
  }), /Tool output byte limit exceeded/);
  assert.equal(disposed, 4);
});

test("async chain stops when the reference omits every unimplemented call", async () => {
  let rounds = 0, visited = 0;
  for await (const ignored of streamLlmToolChain({async: true, context: context(), tools: [],
    async *openResponse() {rounds++; yield {type: "response", response: {model: "fixture", toolCalls: [{name: "missing", arguments: {}}]}};},
    visit() {visited++;}
  })) void ignored;
  assert.equal(rounds, 1); assert.equal(visited, 0);
});

test("async chain waits for every visitor and preserves call indices across rounds", async () => {
  const gate = deferred(), staged: string[] = [], completions: number[] = [];
  let rounds = 0;
  for await (const ignored of streamLlmToolChain({async: true, context: context(),
    tools: [{name: "run", inputSchema: {}, async: true, async implementation(args) {
      if (args.n === 0) await gate.promise;
      return {output: "done " + args.n};
    }}],
    async *openResponse() {
      if (rounds++) {
        assert.deepEqual(staged, ["done 0", "done 1"]);
        yield {type: "response", response: {model: "fixture"}};
      } else yield {type: "response", response: {model: "fixture", toolCalls: [0,1].map(n => ({name: "run", arguments: {n}}))}};
    },
    async visit(result, index) {
      let value = "";
      for await (const bytes of result.output.bytes) value += new TextDecoder().decode(bytes);
      staged[index] = value; completions.push(index);
      if (index === 1) gate.resolve();
    }
  })) void ignored;
  assert.equal(rounds, 2); assert.deepEqual(completions, [1,0]);
});

test("async batch preserves external cancellation and retires both pending readers", async () => {
  const controller = new AbortController(), pending = deferred();
  const failure = new Error("cancel batch"); let readers = 0, disposed = 0;
  const execution = executeLlmToolCalls({async: true, context: {...context(), signal: controller.signal},
    calls: [0,1].map(n => ({name: "run", arguments: {n}})),
    tools: [{name: "run", inputSchema: {}, async: true, async implementation() {
      return {source: {bytes: {async *[Symbol.asyncIterator]() {
        if (++readers === 2) pending.resolve();
        await new Promise<void>(() => {});
        yield new Uint8Array();
      }}, async dispose() {disposed++;}}};
    }}]
  }, async result => {for await (const ignored of result.output.bytes) void ignored;});
  await pending.promise;
  controller.abort(failure);
  await assert.rejects(execution, error => error === failure);
  assert.equal(disposed, 2);
});

test("serial mode keeps declared coroutine implementations serial", async () => {
  let active = false;
  await executeLlmToolCalls({context: context(), calls: [0,1].map(n => ({name: "run", arguments: {n}})),
    tools: [{name: "run", inputSchema: {}, async: true, async implementation() {
      assert.equal(active, false); active = true; return {output: "done"};
    }}]
  }, async result => {for await (const ignored of result.output.bytes) void ignored; active = false;});
});
