import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runAcpCore as own } from "../dist/acp-core.js";
import { createRunContext as ownContext } from "../dist/run-context.js";
import { runAcpCore as reference } from "../../poe-agent/dist/runtime/acp-core.js";
import { createRunContext as referenceContext } from "../../poe-agent/dist/runtime/run-context.js";
import { AsyncEventQueue } from "../dist/event-queue.js";
const native = createRequire(import.meta.url)("../dist/poe-agent-rust.node");
async function drain(iterable) {
  const events = [];
  for await (const event of iterable) events.push(event);
  return events;
}
function response(events) {
  return {
    events: (async function* () {
      yield* events;
    })()
  };
}

test("agent queue retains FIFO, concurrent waiters, drain-before-close and arbitrary payload identity", async () => {
  const queue = new AsyncEventQueue(() => {}),
    opaque = { owned: true };
  const waits = Array.from({ length: 64 }, () => queue.next());
  for (let n = 0; n < 64; n++) queue.push({ n, opaque });
  const delivered = await Promise.all(waits);
  for (let n = 0; n < 64; n++)
    assert.deepEqual(delivered[n], { done: false, value: { n, opaque } });
  for (let n = 0; n < 2048; n++) queue.push(n);
  queue.close();
  queue.close();
  queue.push("discarded");
  assert.deepEqual(
    await drain(queue),
    Array.from({ length: 2048 }, (_, n) => n)
  );
  assert.deepEqual(await queue.next(), { done: true, value: undefined });
  let returns = 0;
  const returned = new AsyncEventQueue(() => {
    returns++;
  });
  const waiting = Array.from({ length: 64 }, () => returned.next());
  await returned.return();
  assert.equal(returns, 1);
  assert.ok((await Promise.all(waiting)).every((result) => result.done));
  const cause = { failed: true },
    bad = new AsyncEventQueue(() => {
      throw cause;
    });
  await assert.rejects(bad.return(), (error) => error === cause);
  bad.push(opaque);
  assert.equal((await bad.next()).value, opaque);
});

test("model stops produce one terminal error and preserve limit getter/coercion behavior", async () => {
  for (const reason of ["error", "max_tokens", "end_turn", undefined]) {
    const results = [];
    for (const [run, create] of [
      [reference, referenceContext],
      [own, ownContext]
    ]) {
      const reads = [],
        context = create();
      let calls = 0;
      const maximum = {
        valueOf() {
          reads.push("valueOf");
          return 1;
        }
      };
      const options = {
        prompt: "owned",
        runContext: context,
        host: {
          handle() {
            throw Error("no tools");
          },
          fork() {
            throw Error("no forks");
          }
        },
        model: {
          async complete() {
            calls++;
            return response([
              { type: "text", text: "done" },
              { type: "stop", reason }
            ]);
          }
        },
        get maxIterations() {
          reads.push("max");
          return maximum;
        }
      };
      const events = await drain(run(options));
      results.push({
        reads,
        calls,
        events: events.map((event) =>
          event.type === "session.error"
            ? { type: event.type, name: event.error.name, message: event.error.message }
            : event
        )
      });
    }
    assert.deepEqual(results[1], results[0]);
  }
  for (const maximum of [NaN, Infinity, -Infinity, -1, 0, 0.5, 1, "1", null, Symbol("invalid")]) {
    const results = [];
    for (const [run, create] of [
      [reference, referenceContext],
      [own, ownContext]
    ]) {
      const events = await drain(
        run({
          prompt: "owned",
          runContext: create(),
          maxIterations: maximum,
          host: {},
          model: {
            async complete() {
              return response([{ type: "text", text: "done" }]);
            }
          }
        })
      );
      results.push(
        events.map((event) =>
          event.type === "session.error" ? { type: event.type, name: event.error.name } : event
        )
      );
    }
    assert.deepEqual(results[1], results[0]);
  }
});

test("canceled ignored host work releases listeners and later emissions cannot create second terminal events", async () => {
  for (const [run, create] of [
    [reference, referenceContext],
    [own, ownContext]
  ]) {
    const context = create(),
      controller = new AbortController(),
      reason = { cancel: true };
    let emit, started;
    const start = new Promise((resolve) => {
      started = resolve;
    });
    let adds = 0,
      removes = 0;
    const add = controller.signal.addEventListener.bind(controller.signal),
      remove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = (...args) => {
      adds++;
      return add(...args);
    };
    controller.signal.removeEventListener = (...args) => {
      removes++;
      return remove(...args);
    };
    const iterator = run({
      prompt: "owned",
      runContext: context,
      signal: controller.signal,
      host: {
        setEmit(value) {
          emit = value;
        },
        handle() {
          started();
          return new Promise(() => {});
        }
      },
      model: {
        async complete() {
          return response([{ type: "tool_use_complete", id: "call", name: "echo", args: {} }]);
        }
      }
    });
    const events = drain(iterator);
    await start;
    controller.abort(reason);
    const received = await events;
    assert.equal(received.filter((event) => event.type.startsWith("session.")).length, 1);
    const terminal = received.at(-1);
    assert.equal(terminal.type, "session.error");
    assert.equal(terminal.error.cause, reason);
    emit({ type: "message.delta", content: "late" });
    assert.deepEqual(await iterator.next(), { done: true, value: undefined });
    assert.equal(adds, 1);
    assert.equal(removes, 1);
  }
});

test("native run state suppresses terminal repeats and admits changing stop getters in order", () => {
  const state = new native.NativeAgentExecution(),
    reads = [];
  let n = 0;
  assert.throws(
    () =>
      state.checkStop({
        get stopReason() {
          reads.push("stop");
          return ["end_turn", "max_tokens"][n++];
        }
      }),
    /maximum token limit/
  );
  assert.deepEqual(reads, ["stop", "stop"]);
  assert.equal(state.acceptTerminal(), true);
  assert.equal(state.acceptTerminal(), false);
  assert.equal(state.acceptsEvent(), false);
});

test("seeded histories preserve request layout, compaction system rules and multimodal reasoning", async () => {
  let seed = 0x5eed2026;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let sample = 0; sample < 64; sample++) {
    const messages = [];
    for (let n = 0; n < 16; n++) {
      const role = ["system", "user", "assistant", "tool"][random() % 4];
      messages.push({
        role,
        content:
          random() % 2 ? "🌍\ud800" : [{ type: "image", mimeType: "image/png", data: "AA==" }],
        ...(random() % 2 ? { name: "compaction" } : {}),
        ...(random() % 2 ? { toolCallId: "call" } : {}),
        reasoning_content: "thought",
        reasoning: "thought",
        thinking: [{ text: "owned", signature: "s" }],
        redacted_thinking: [{ data: "opaque" }],
        reasoning_details: [{ sample, n }],
        tool_calls: [
          {
            id: "call",
            type: "function",
            function: { name: "echo", arguments: '{ "raw" : true }' }
          }
        ]
      });
    }
    const results = [];
    for (const [run, create] of [
      [reference, referenceContext],
      [own, ownContext]
    ]) {
      const context = create();
      context.messages.push(...messages);
      let captured;
      await drain(
        run({
          prompt: "request",
          baseSystemPrompt: "compiled",
          runContext: context,
          host: {},
          model: {
            async complete(request) {
              captured = request.messages;
              return response([{ type: "text", text: "done" }]);
            }
          }
        })
      );
      results.push(captured);
    }
    assert.deepEqual(results[1], results[0]);
  }
});

test("message-copy getters, custom map callbacks and arbitrary copy failures match the original", async () => {
  for (const cause of [undefined, null, false, 0, "", { failed: true }]) {
    const results = [];
    for (const [run, create] of [
      [reference, referenceContext],
      [own, ownContext]
    ]) {
      const reads = [],
        context = create();
      let captured;
      const message = {
        get role() {
          reads.push("role");
          return "assistant";
        },
        get content() {
          reads.push("content");
          return "owned";
        },
        get reasoning_content() {
          reads.push("reasoning_content");
          return "thought";
        },
        get thinking() {
          reads.push("thinking");
          return {
            map(callback) {
              reads.push("map");
              if (cause !== undefined) throw cause;
              return [
                callback({
                  get text() {
                    reads.push("text");
                    return "thinking";
                  },
                  signature: "s"
                })
              ];
            }
          };
        },
        get name() {
          reads.push("name");
          return "echo";
        },
        get tool_calls() {
          reads.push("tool_calls");
          return [];
        }
      };
      context.messages.push(message);
      const events = await drain(
        run({
          prompt: "request",
          runContext: context,
          host: {},
          model: {
            async complete(request) {
              captured = request.messages;
              return response([{ type: "text", text: "done" }]);
            }
          }
        })
      );
      results.push({
        reads,
        captured,
        events: events.map((event) =>
          event.type === "session.error"
            ? { type: event.type, name: event.error.name, message: event.error.message }
            : event.type === "session.complete"
              ? { type: event.type, output: event.result.output }
              : event
        )
      });
    }
    assert.deepEqual(results[1], results[0]);
  }
});
