import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/index.js";
import * as reference from "../../agent-spawn/dist/index.js";
import * as originalMcp from "../../agent-spawn/dist/configs/mcp.js";
test("all builtin launch permutations agree with the original without running an agent", () => {
  const normalize = (callback) => {
    try {
      return { value: callback() };
    } catch (error) {
      return { error: error.message };
    }
  };
  let cases = 0;
  for (const id of [
    "claude-code",
    "codex",
    "cursor",
    "pi",
    "opencode",
    "goose",
    "unknown",
    "claude-desktop"
  ])
    for (const mode of [undefined, "yolo", "auto", "edit", "read"])
      for (const model of [
        undefined,
        "",
        " ",
        "poe/anthropic/claude-opus-4.6",
        "openai/gpt-5",
        "x\ud800"
      ])
        for (const useStdin of [false, true])
          for (const resumeThreadId of [undefined, "session", "{{cwd}}"]) {
            const options = {
              prompt: "private 🌍\ntext",
              mode,
              model,
              useStdin,
              resumeThreadId,
              cwd: "/work",
              args: ["extra"]
            };
            assert.deepEqual(
              normalize(() => own.buildSpawnArgs(id, options)),
              normalize(() => reference.buildSpawnArgs(id, options)),
              JSON.stringify({ id, options })
            );
            cases++;
          }
  assert.equal(cases, 1440);
});
test("MCP serializers preserve UTF-16 payloads and prototype-named data", () => {
  const servers = JSON.parse(
    '{"__proto__":{"command":"node","args":["a\\ud800"],"env":{"constructor":"x","__proto__":"data"}},"odd.name":{"command":"q\\ud800"}}'
  );
  for (const name of [
    "toJsonMcpServers",
    "serializeJsonMcpArgs",
    "serializeCodexMcpArgs",
    "serializeOpenCodeMcpEnv"
  ])
    assert.deepEqual(own[name](servers), originalMcp[name](servers), name);
  const simple = { odd: { command: "x\ud800", args: ["y\udc00"] } };
  assert.deepEqual(own.serializeGooseMcpArgs(simple), originalMcp.serializeGooseMcpArgs(simple));
});
test("environment deletion and insertion order survive null-prototype records", () => {
  const a = JSON.parse('{"__proto__":"safe","PATH":"a","constructor":"own"}'),
    b = { PATH: undefined, NEW: "value" },
    c = { PATH: "b" };
  assert.deepEqual(
    own.mergeSpawnEnvironment(a, undefined, b, c),
    reference.mergeSpawnEnvironment(a, undefined, b, c)
  );
  assert.equal(Object.getPrototypeOf(own.mergeSpawnEnvironment(a)), null);
});
test("ACP argument recipes agree for empty, absent and null option values", () => {
  for (const id of ["gemini-cli", "opencode", "goose"]) {
    const acp = own.getAcpSpawnConfig(id),
      original = reference.getAcpSpawnConfig(id);
    for (const model of [undefined, "", " ", "poe/gemini-pro"])
      for (const mode of [undefined, "yolo", "auto", "edit", "read"])
        for (const mcpServers of [
          undefined,
          null,
          {},
          { one: { command: "node" } },
          { "x\ud800": { command: "node" } }
        ]) {
          const options = { model, mode, mcpServers };
          const invoke = (config) =>
            typeof config.acpArgs === "function" ? config.acpArgs(options) : config.acpArgs;
          assert.deepEqual(invoke(acp), invoke(original), JSON.stringify({ id, options }));
        }
  }
});
test("retry captures its callback once before asynchronous attempts", async () => {
  for (const implementation of [reference, own]) {
    let finish,
      calls = 0;
    const once = () => ({
      events: { async *[Symbol.asyncIterator]() {} },
      result: new Promise((resolve) => {
        calls++;
        finish = resolve;
      })
    });
    const options = { maxAttempts: 2, backoffMs: 0, isRetryable: () => false };
    const handle = implementation.createSpawnRetry(once)("agent", {}, options);
    options.isRetryable = () => {
      throw Error("mutated callback must not run");
    };
    finish({ exitCode: 1 });
    assert.equal((await handle.result).exitCode, 1);
    assert.equal(calls, 1);
    for await (const ignored of handle.events) void ignored;
  }
});
test("parallel preserves payload identity and cleans linked cancellation listeners", async () => {
  const { getEventListeners } = await import("node:events");
  for (const implementation of [reference, own]) {
    const parent = new AbortController(),
      individual = new AbortController(),
      payload = {};
    payload.self = payload;
    let complete;
    const parallel = implementation.createSpawnParallel((_service, options) => ({
      events: { async *[Symbol.asyncIterator]() {} },
      result: new Promise((resolve) => {
        complete = () => resolve({ exitCode: 0, payload, signal: options.signal });
      })
    }));
    const result = parallel([["agent", { signal: individual.signal }]], { signal: parent.signal });
    assert.equal(getEventListeners(parent.signal, "abort").length, 1);
    assert.equal(getEventListeners(individual.signal, "abort").length, 1);
    complete();
    const [value] = await result;
    assert.equal(value.payload, payload);
    assert.equal(getEventListeners(parent.signal, "abort").length, 0);
    assert.equal(getEventListeners(individual.signal, "abort").length, 0);
  }
});
test("command options getters are read once and UTF-8 streams retain complete text", async () => {
  for (const implementation of [reference, own]) {
    let reads = 0;
    const options = {
      get stdin() {
        reads++;
        return reads === 1 ? "first 🌍" : "incorrect second value";
      }
    };
    const result = await implementation.runCommand(
      process.execPath,
      ["-e", "process.stdin.pipe(process.stdout)"],
      options
    );
    assert.equal(result.stdout, "first 🌍");
    assert.equal(result.exitCode, 0);
    assert.equal(reads, 1);
  }
});
test("thread extraction stops before unrelated getters and adapter output preserves UTF-16", async () => {
  const originalUtils = await import("../../agent-spawn/dist/adapters/utils.js"),
    ownUtils = await import("../dist/adapter-utils.js");
  for (const implementation of [originalUtils, ownUtils]) {
    const value = {
      thread_id: "first",
      get session_id() {
        throw Error("unrelated getter");
      }
    };
    assert.equal(implementation.extractThreadId(value), "first");
  }
  const ownAdapters = await import("../dist/adapters.js");
  for (const [name, lines] of [
    ["adaptNative", [JSON.stringify({ event: "custom", text: "x\ud800", __proto__: null })]],
    [
      "adaptClaude",
      [
        JSON.stringify({
          type: "assistant",
          session_id: "x\ud800",
          message: {
            content: [{ type: "tool_use", id: "a", name: "Read", input: { file_path: "x\ud800" } }]
          }
        }),
        JSON.stringify({
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "a", content: { x: "\udc00" } }]
          }
        })
      ]
    ],
    [
      "adaptCodex",
      [
        JSON.stringify({
          type: "item.completed",
          item: { type: "command_execution", id: "x\ud800", exit_code: 0 }
        })
      ]
    ]
  ]) {
    const referenceAdapter = (await import("../../agent-spawn/dist/adapters/index.js"))[name];
    const collect = async (fn) => {
      const values = [];
      for await (const value of fn({
        async *[Symbol.asyncIterator]() {
          yield* lines;
        }
      }))
        values.push(value);
      return values;
    };
    assert.deepEqual(await collect(ownAdapters[name]), await collect(referenceAdapter), name);
  }
});
test("middleware repeat guards precede callback getters", async () => {
  for (const implementation of [reference, own]) {
    let reads = 0;
    const chain = [
      async (_context, next) => {
        await next();
        await next();
      },
      undefined
    ];
    Object.defineProperty(chain, 1, {
      get() {
        reads++;
        return async () => {};
      }
    });
    await assert.rejects(implementation.applyMiddlewares(chain, {}), {
      message: "next() called multiple times"
    });
    assert.equal(reads, 1);
  }
});
test("line framing agrees for every UTF-8 split and preserves CR/empty lines", async () => {
  const { Readable } = await import("node:stream");
  const input = Buffer.from("first 🌍\r\n\nnext 🧪\nlast");
  const collect = async (stream) => {
    const values = [];
    for await (const value of stream) values.push(value);
    return values;
  };
  for (let split = 0; split <= input.length; split++) {
    const chunks = [input.subarray(0, split), input.subarray(split)];
    assert.deepEqual(
      await collect(own.readLines(Readable.from(chunks))),
      await collect(reference.readLines(Readable.from(chunks)))
    );
  }
  assert.deepEqual(await collect(own.readLines(Readable.from(["x\ud800\n", "last\udc00"]))), [
    "x\ud800",
    "last\udc00"
  ]);
  for (const reason of [undefined, null, false, 0, "", 0n])
    await assert.rejects(
      own.applyMiddlewares(
        [
          async () => {
            throw reason;
          }
        ],
        {}
      ),
      (error) => Object.is(error, reason)
    );
});
test("session conversion defers opaque payload effects until emitted tool events", () => {
  for (const implementation of [reference, own]) {
    const state = implementation.createToolRenderState();
    const update = {
      sessionUpdate: "tool_call_update",
      toolCallId: "t",
      status: "pending",
      get rawOutput() {
        throw Error("must not serialize pending output");
      }
    };
    assert.equal(implementation.sessionUpdateToEvents(update, state)[0].event, "tool_start");
    const repeated = {
      sessionUpdate: "tool_call",
      toolCallId: "t",
      kind: "read",
      title: "file",
      status: "pending",
      get rawInput() {
        throw Error("must not read input for a deduplicated start");
      }
    };
    assert.deepEqual(implementation.sessionUpdateToEvents(repeated, state), []);
  }
});
test("session conversion preserves opaque input/plan identity, mutable state and NaN usage", () => {
  for (const implementation of [reference, own]) {
    const state = implementation.createToolRenderState(),
      payload = {};
    payload.self = payload;
    const entry = { content: "step", priority: "medium", status: "pending", _meta: payload },
      entries = [entry];
    assert.equal(
      implementation.sessionUpdateToEvents({ sessionUpdate: "plan", entries }, state)[0].entries,
      entries
    );
    const update = {
      sessionUpdate: "tool_call",
      toolCallId: "t\ud800",
      title: "file\udc00",
      kind: "execute",
      rawInput: payload,
      status: "pending"
    };
    assert.equal(implementation.sessionUpdateToEvents(update, state)[0].input, payload);
    state.startedToolCalls.clear();
    state.toolCallKinds.set(update.toolCallId, "read");
    const complete = implementation.sessionUpdateToEvents(
      {
        sessionUpdate: "tool_call_update",
        toolCallId: update.toolCallId,
        status: "completed",
        rawInput: payload,
        rawOutput: payload
      },
      state
    );
    assert.equal(complete[0].kind, "read");
    assert.equal(complete[0].input, payload);
    assert.equal(complete[1].path, "[object Object]");
    const usage = implementation.sessionUpdateToEvents(
      {
        sessionUpdate: "usage_update",
        used: 10,
        size: 20,
        _meta: { inputTokens: NaN, outputTokens: Infinity, cachedTokens: NaN },
        cost: { amount: 0.1, currency: "USD" }
      },
      state
    )[0];
    assert.ok(Number.isNaN(usage.inputTokens));
    assert.equal(usage.outputTokens, Infinity);
    assert.equal(Object.hasOwn(usage, "cachedTokens"), false);
    assert.equal(usage.costUsd, 0.1);
  }
});
test("reported costs are read only for USD and unused update titles stay opaque", () => {
  for (const implementation of [reference, own]) {
    for (const currency of ["USD", "EUR"]) {
      let reads = 0;
      const value = implementation.sessionUpdateToEvents(
        {
          sessionUpdate: "usage_update",
          used: 1,
          size: 2,
          cost: {
            currency,
            get amount() {
              reads++;
              return 0.1;
            }
          }
        },
        implementation.createToolRenderState()
      )[0];
      assert.equal(reads, currency === "USD" ? 1 : 0);
      assert.equal(Object.hasOwn(value, "costUsd"), currency === "USD");
    }
    assert.deepEqual(
      implementation.sessionUpdateToEvents(
        {
          sessionUpdate: "tool_call_update",
          toolCallId: "t",
          get title() {
            throw Error("unused title");
          }
        },
        implementation.createToolRenderState()
      ),
      []
    );
  }
});
