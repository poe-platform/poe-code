import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import {
  executeLlmToolCalls,
  LlmCancelToolCall,
  type LlmExecutableTool,
  type LlmToolExecutionResult,
  type LlmToolOutput
} from "./tool-execution.js";
import fixtures from "./fixtures/tool-execution-0.27.1.json" with { type: "json" };

for (const fixture of fixtures)
  test(`pinned serial tool execution: ${fixture.mode}`, async () => {
    const events: unknown[] = [];
    const results: unknown[] = [];
    let released = 0;
    const implementation: NonNullable<LlmExecutableTool["implementation"]> = async (args) => {
      events.push(["execute", args]);
      if (fixture.mode === "failure") throw new Error("broken tool");
      if (fixture.mode === "attachment")
        return {
          output: "image ready",
          attachments: [
            {
              mimeType: "image/png",
              source: {
                bytes: toByteSource("abc"),
                async dispose() {
                  released++;
                }
              }
            }
          ]
        };
      return { output: { city: "Zürich", args, ok: true, none: null } };
    };
    const tools: LlmExecutableTool[] = [
      {
        name: "lookup",
        inputSchema: {},
        ...(fixture.mode === "no_implementation" ? {} : { implementation })
      }
    ];
    if (fixture.mode === "duplicate")
      tools.push({
        name: "lookup",
        inputSchema: {},
        implementation: () => ({ output: "last wins" })
      });
    let failure: string | null = null;
    try {
      await executeLlmToolCalls(
        {
          tools,
          calls: [
            {
              id: "id0",
              name: fixture.mode === "missing" ? "missing" : "lookup",
              arguments: { query: "one" }
            },
            { id: "id1", name: "lookup", arguments: { query: "one" } }
          ],
          context: { fs: new MemoryFileSystem(), cwd: "/", signal: new AbortController().signal },
          beforeCall(tool, call) {
            events.push(["before", tool?.name ?? null, call.name]);
            if (fixture.mode === "cancel") throw new LlmCancelToolCall("user declined");
          }
        },
        async (result) => {
          let output = "";
          for await (const bytes of result.output.bytes) output += new TextDecoder().decode(bytes);
          if (result.executed) events.push(["after", result.call.name, output]);
          const attachments = [];
          for (const attachment of result.attachments) {
            const bytes: number[] = [];
            if (attachment.source)
              for await (const chunk of attachment.source.bytes) bytes.push(...chunk);
            attachments.push({ mimeType: attachment.mimeType, bytes });
          }
          results.push({
            name: result.call.name,
            output,
            id: result.call.id,
            hasException: result.exception !== undefined,
            attachments
          });
        }
      );
    } catch (error) {
      failure = (error as Error).message;
    }
    assert.equal(failure, fixture.failure);
    assert.deepEqual(events, fixture.events);
    assert.deepEqual(
      results,
      fixture.results.map(({ exception, ...value }) => ({
        ...value,
        hasException: exception !== null
      }))
    );
    assert.equal(released, fixture.mode === "attachment" ? 2 : 0);
  });

const context = () => ({
  fs: new MemoryFileSystem(),
  cwd: "/",
  signal: new AbortController().signal
});
const calls = [{ name: "run", arguments: {} }];

test("tool leases stop within a large chunk when explicitly disposed", async () => {
  let released = 0;
  const source = {
    bytes: toByteSource(new Uint8Array(32768)),
    async dispose() {
      released++;
    }
  };
  await executeLlmToolCalls(
    {
      context: context(),
      calls,
      tools: [{ name: "run", inputSchema: {}, implementation: () => ({ source }) }]
    },
    async (result) => {
      const reader = result.output.bytes[Symbol.asyncIterator]();
      assert.equal((await reader.next()).value.length, 16384);
      await result.output.dispose();
      await assert.rejects(reader.next(), /closed/);
    }
  );
  assert.equal(released, 1);
});

test("tool output and attachments share one byte budget across calls", async () => {
  let released = 0;
  const remaining: number[] = [];
  await assert.rejects(
    executeLlmToolCalls(
      {
        context: context(),
        calls: [...calls, ...calls],
        maxOutputBytes: 5,
        tools: [
          {
            name: "run",
            inputSchema: {},
            implementation: (_, ctx) => {
              remaining.push(ctx.maxBytes);
              return {
                output: "ab",
                attachments: [
                  {
                    mimeType: "text/plain",
                    source: {
                      bytes: toByteSource("cd"),
                      async dispose() {
                        released++;
                      }
                    }
                  }
                ]
              };
            }
          }
        ]
      },
      async (result) => {
        for await (const ignoredChunk of result.output.bytes) {
          /* consume */
        }
        for await (const ignoredChunk of result.attachments[0]!.source!.bytes) {
          /* consume */
        }
      }
    ),
    /byte limit exceeded/
  );
  assert.deepEqual(remaining, [5, 1]);
  assert.equal(released, 2);
});

test("visitor failure releases unread output and attachments and stops later calls", async () => {
  let released = 0,
    executed = 0;
  const failure = new Error("visitor failed");
  const source = {
    bytes: toByteSource("content"),
    async dispose() {
      released++;
    }
  };
  await assert.rejects(
    executeLlmToolCalls(
      {
        context: context(),
        calls: [...calls, ...calls],
        tools: [
          {
            name: "run",
            inputSchema: {},
            implementation: () => {
              executed++;
              return { source, attachments: [{ mimeType: "text/plain", source }] };
            }
          }
        ]
      },
      () => {
        throw failure;
      }
    ),
    (error) => error === failure
  );
  assert.equal(executed, 1);
  assert.equal(released, 1);
});

test("result leases cannot escape the visitor or be read twice", async () => {
  let retained: LlmToolExecutionResult | undefined;
  await executeLlmToolCalls(
    {
      context: context(),
      calls,
      tools: [{ name: "run", inputSchema: {}, implementation: () => ({ output: "ok" }) }]
    },
    async (result) => {
      retained = result;
      for await (const ignoredChunk of result.output.bytes) {
        /* consume */
      }
      await assert.rejects(result.output.bytes[Symbol.asyncIterator]().next(), /already consumed/);
    }
  );
  await assert.rejects(retained!.output.bytes[Symbol.asyncIterator]().next(), /closed/);
});

test("abort retires sources returned by a pending implementation", async () => {
  const controller = new AbortController();
  let finish!: (output: LlmToolOutput) => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<LlmToolOutput>((resolve) => {
    finish = resolve;
  });
  let disposed!: () => void;
  const released = new Promise<void>((resolve) => {
    disposed = resolve;
  });
  const failure = new Error("aborted");
  const execution = executeLlmToolCalls(
    {
      context: { ...context(), signal: controller.signal },
      calls,
      tools: [
        {
          name: "run",
          inputSchema: {},
          implementation: () => {
            started();
            return pending;
          }
        }
      ]
    },
    () => assert.fail("no late visit")
  );
  const rejected = assert.rejects(execution, (error) => error === failure);
  await entered;
  controller.abort(failure);
  await rejected;
  finish({
    source: {
      bytes: toByteSource("late"),
      async dispose() {
        disposed();
      }
    }
  });
  await released;
});

test("invalid envelopes release adopted attachments before reporting failure", async () => {
  let released = 0;
  const source = {
    bytes: toByteSource("x"),
    async dispose() {
      released++;
    }
  };
  await executeLlmToolCalls(
    {
      context: context(),
      calls,
      tools: [
        {
          name: "run",
          inputSchema: {},
          implementation: () =>
            ({
              source,
              output: "invalid",
              attachments: [{ mimeType: "text/plain", source }]
            }) as unknown as LlmToolOutput
        }
      ]
    },
    (result) => {
      assert.match((result.exception as Error).message, /Invalid tool output/);
    }
  );
  assert.equal(released, 1);
});

test("null source envelopes produce a tool error instead of undefined output", async () => {
  await executeLlmToolCalls(
    {
      context: context(),
      calls,
      tools: [
        {
          name: "run",
          inputSchema: {},
          implementation: () => ({ source: null }) as unknown as LlmToolOutput
        }
      ]
    },
    (result) => {
      assert.match((result.exception as Error)?.message ?? "", /Invalid tool output source/);
    }
  );
});

test("aborting an outstanding result read retires its source without visiting another call", async () => {
  const controller = new AbortController();
  let pulled!: () => void;
  const reading = new Promise<void>((resolve) => {
    pulled = resolve;
  });
  let released = 0,
    executed = 0;
  const failure = new Error("stop reading");
  const execution = executeLlmToolCalls(
    {
      context: { ...context(), signal: controller.signal },
      calls: [...calls, ...calls],
      tools: [
        {
          name: "run",
          inputSchema: {},
          implementation: () => {
            executed++;
            return {
              source: {
                bytes: {
                  [Symbol.asyncIterator]() {
                    return {
                      next() {
                        pulled();
                        return new Promise<IteratorResult<Uint8Array>>(() => {});
                      }
                    };
                  }
                },
                async dispose() {
                  released++;
                }
              }
            };
          }
        }
      ]
    },
    async (result) => {
      for await (const ignoredChunk of result.output.bytes) {
        /* consume */
      }
    }
  );
  const rejected = assert.rejects(execution, (error) => error === failure);
  await reading;
  controller.abort(failure);
  await rejected;
  assert.equal(released, 1);
  assert.equal(executed, 1);
});

for (const asynchronous of [false, true]) test(`shared tool preparation precedes approvals in async=${asynchronous}`, async () => {
  const events: string[] = [];
  const prepare = async (context: {signal: AbortSignal}, mode: {async: boolean}) => {
    context.signal.throwIfAborted();
    assert.equal(mode.async, asynchronous);
    events.push('prepare');
  };
  const tools = ['one', 'two'].map(name => ({name, inputSchema: {}, prepare, implementation: () => {events.push(name); return {output: 'ok'};}}));
  await executeLlmToolCalls({async: asynchronous, tools,
    calls: [{name: 'one', arguments: {}}], context: {fs: new MemoryFileSystem(), cwd: '/', signal: new AbortController().signal},
    beforeCall() {events.push('approve');}}, () => {events.push('visit');});
  assert.deepEqual(events, ['prepare', 'approve', 'one', 'visit']);
});

test('tool preparation failures stop a batch before approvals or calls', async () => {
  const failure = new Error('prepare failed');
  await assert.rejects(executeLlmToolCalls({tools: [{name: 'one', inputSchema: {}, prepare() {throw failure;}, implementation() {assert.fail('executed');}}],
    calls: [{name: 'one', arguments: {}}], context: {fs: new MemoryFileSystem(), cwd: '/', signal: new AbortController().signal},
    beforeCall() {assert.fail('approved');}}, () => {assert.fail('visited');}), error => error === failure);
});

test('cancellation during preparation preserves identity and prevents approval', async () => {
  const controller = new AbortController();
  const reason = new Error('cancel preparation');
  await assert.rejects(executeLlmToolCalls({async: true, tools: [{name: 'one', inputSchema: {}, async prepare(context) {
    assert.notEqual(context.signal, controller.signal);
    controller.abort(reason);
  }, implementation() {assert.fail('executed');}}], calls: [{name: 'one', arguments: {}}],
    context: {fs: new MemoryFileSystem(), cwd: '/', signal: controller.signal}, beforeCall() {assert.fail('approved');}}, () => {assert.fail('visited');}), error => error === reason);
});

for(const asynchronous of [false,true])for(const exitCode of [0,7])test(`explicit plugin exit ${exitCode} escapes ${asynchronous?'async':'sync'} tool results`,async()=>{
  const {LlmPluginExit}=await import('./loader-provider.js');
  const exit=new LlmPluginExit(exitCode),fs=new MemoryFileSystem();
  await assert.rejects(executeLlmToolCalls({async:asynchronous,context:{fs,cwd:'/',signal:new AbortController().signal},tools:[{name:'halt',inputSchema:{},async:asynchronous,implementation(){throw exit;}}],calls:[{name:'halt',arguments:{}}]},()=>assert.fail('process exit became a tool result')),error=>error===exit);
  assert.deepEqual(await fs.readdir('/'),[]);
});
