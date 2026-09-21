import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { createRequire } from "node:module";
import { collectModelResponseEvents } from "../dist/model-stream.js";
const native = createRequire(import.meta.url)("../dist/poe-agent-rust.node");

const source = new URL("../../poe-agent/src/runtime/acp-core.ts", import.meta.url);
const parsed = ts.createSourceFile(
  source.pathname,
  fs.readFileSync(source, "utf8") + "\nexport {collectModelResponseEvents};",
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);
const transformed = ts.transform(parsed, [
  (context) => (root) =>
    ts.visitNode(root, function visit(node) {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text.startsWith(".")
      )
        return ts.factory.updateImportDeclaration(
          node,
          node.modifiers,
          node.importClause,
          ts.factory.createStringLiteral(
            new URL(
              "../../poe-agent/dist/runtime/" + node.moduleSpecifier.text.slice(2),
              import.meta.url
            ).href
          ),
          node.attributes
        );
      return ts.visitEachChild(node, visit, context);
    })
]);
let reference;
try {
  const javascript = ts.transpileModule(ts.createPrinter().printFile(transformed.transformed[0]), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  reference = (
    await import("data:text/javascript;base64," + Buffer.from(javascript).toString("base64"))
  ).collectModelResponseEvents;
} finally {
  transformed.dispose();
}

async function compare(factory, emit = true) {
  const results = [];
  for (const collect of [reference, collectModelResponseEvents]) {
    const emitted = [];
    const value = await collect({
      response: {
        events: (async function* () {
          yield* factory();
        })()
      },
      ...(emit
        ? {
            emit(event) {
              emitted.push(event);
            }
          }
        : {})
    });
    results.push({ value, emitted });
  }
  assert.deepEqual(results[1], results[0]);
  return results[1];
}
test("model stream collection matches text, signed thinking, opaque payloads, usage and stop updates", async () => {
  const opaque = { retained: true };
  await compare(() => [
    { type: "text", text: "" },
    { type: "text", text: "hello 🌍\ud800" },
    { type: "thinking", text: "one", signature: "s" },
    { type: "thinking", text: "two", signature: "s" },
    { type: "thinking", text: "three" },
    { type: "redacted_thinking", data: opaque },
    { type: "reasoning_details", payload: opaque },
    { type: "usage", inputTokens: 1, outputTokens: 2, cachedTokens: 3, cacheCreationTokens: 4 },
    {
      type: "usage",
      inputTokens: NaN,
      outputTokens: Infinity,
      cachedTokens: -0,
      cacheCreationTokens: opaque
    },
    { type: "stop", reason: "tool_use" },
    { type: "stop", reason: "end_turn" }
  ]);
});
test("model tool streams correlate repeated IDs, emit valid partial intents once and retain exact JSON", async () => {
  const args = { text: "owned" };
  const events = () => [
    { type: "tool_use_delta", id: "call\ud800", name: " echo ", argsDelta: '{"text":' },
    { type: "tool_use_delta", id: "call\ud800", name: " ", argsDelta: '"owned"}' },
    { type: "tool_use_delta", id: "call\ud800", argsDelta: " " },
    { type: "tool_use_complete", id: "call\ud800", name: " echo ", args },
    { type: "tool_use_complete", id: "raw", name: "echo", args: '{ "raw" : true }' },
    { type: "tool_use_complete", id: "discard", name: " ", args: {} },
    { type: "tool_use_delta", id: "bad", name: "echo", argsDelta: "{" },
    { type: "tool_use_json_parse_error", id: "bad", raw: "{", error: "bad JSON" },
    { type: "tool_use_delta", id: "unfinished", name: "echo", argsDelta: "{}" }
  ];
  const result = await compare(events);
  assert.equal(result.value.toolOutcomes[0].toolCall.args, args);
  await compare(events, false);
});
test("model collection preserves accessor order, arbitrary stream causes and emitter rejection", async () => {
  const observations = [];
  for (const collect of [reference, collectModelResponseEvents]) {
    const reads = [];
    let text = 0;
    const event = {
      get type() {
        reads.push("type");
        return "text";
      },
      get text() {
        reads.push("text");
        return ["admit", "stored", "emitted"][text++];
      }
    };
    const emitted = [];
    const value = await collect({
      response: {
        events: (async function* () {
          yield event;
        })()
      },
      emit(event) {
        emitted.push(event);
      }
    });
    observations.push({ reads, emitted, value });
  }
  assert.deepEqual(observations[1], observations[0]);
  for (const collect of [reference, collectModelResponseEvents])
    for (const reason of [null, false, 0, "", { failed: true }]) {
      await assert.rejects(
        collect({
          response: {
            events: (async function* () {
              throw reason;
            })()
          }
        }),
        (error) => error === reason
      );
      await assert.rejects(
        collect({
          response: {
            events: (async function* () {
              yield { type: "text", text: "owned" };
            })()
          },
          emit() {
            throw reason;
          }
        }),
        (error) => error === reason
      );
    }
});

test("emitters are read at the original stage and retain direct-text versus helper invocation contexts", async () => {
  const observations = [];
  for (const collect of [reference, collectModelResponseEvents]) {
    const reads = [];
    const options = {
      response: {
        events: (async function* () {
          yield {
            type: "text",
            get text() {
              reads.push("text");
              return "owned";
            }
          };
          yield { type: "tool_use_delta", id: "call", name: "echo", argsDelta: "{}" };
        })()
      },
      get emit() {
        reads.push("emit");
        return function (event) {
          reads.push(this === options ? "options" : "none");
        };
      }
    };
    const value = await collect(options);
    observations.push({ reads, value });
  }
  assert.deepEqual(observations[1], observations[0]);
});

test("superseded usage and stop snapshots release their opaque GC arena roots during collection", async () => {
  const prototype = native.NativeAgentModelCollector.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "finish");
  let retained;
  Object.defineProperty(prototype, "finish", {
    ...descriptor,
    value: function (roots) {
      retained = Object.keys(roots).length;
      return descriptor.value.call(this, roots);
    }
  });
  try {
    const value = await collectModelResponseEvents({
      response: {
        events: (async function* () {
          for (let index = 0; index < 128; index++) {
            yield {
              type: "usage",
              inputTokens: index,
              outputTokens: index,
              cachedTokens: index,
              cacheCreationTokens: { index }
            };
            yield { type: "stop", reason: "end_turn" };
          }
        })()
      }
    });
    assert.equal(value.usage.cacheCreationTokens.index, 127);
    assert.equal(retained, 5);
    let intents = 0;
    const incomplete = await collectModelResponseEvents({
      response: {
        events: (async function* () {
          for (let index = 0; index < 128; index++)
            yield { type: "tool_use_delta", id: String(index), name: "echo", argsDelta: "null" };
        })()
      },
      emit(event) {
        assert.equal(event.args, null);
        intents++;
      }
    });
    assert.equal(intents, 128);
    assert.deepEqual(incomplete.toolOutcomes, []);
    assert.equal(retained, 0);
  } finally {
    Object.defineProperty(prototype, "finish", descriptor);
  }
});

test("seeded interleaved model streams match the current TypeScript collector", async () => {
  let seed = 0x5eed2026;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const payloads = [null, false, 0, "", { opaque: true }, [1, "🌍"]];
  for (let sample = 0; sample < 64; sample++) {
    const events = [];
    for (let index = 0; index < 128; index++) {
      const id = "call-" + (random() % 8);
      const value = payloads[random() % payloads.length];
      switch (random() % 10) {
        case 0:
          events.push({ type: "text", text: ["", "🌍", "\ud800", "alpha"][random() % 4] });
          break;
        case 1:
          events.push({
            type: "thinking",
            text: "thought",
            signature: [undefined, "s", "other"][random() % 3]
          });
          break;
        case 2:
          events.push({ type: "redacted_thinking", data: value });
          break;
        case 3:
          events.push({ type: "reasoning_details", payload: value });
          break;
        case 4:
          events.push({
            type: "tool_use_delta",
            id,
            name: [undefined, " echo ", "\uFEFF", "other"][random() % 4],
            argsDelta: ["", "{", "}", "null", "1", " "][random() % 6]
          });
          break;
        case 5:
          events.push({
            type: "tool_use_complete",
            id,
            name: ["echo", " ", "\uFEFFother\uFEFF"][random() % 3],
            args: value
          });
          break;
        case 6:
          events.push({ type: "tool_use_json_parse_error", id, raw: "{", error: value });
          break;
        case 7:
          events.push({
            type: "usage",
            inputTokens: index,
            outputTokens: value,
            cachedTokens: undefined,
            cacheCreationTokens: value
          });
          break;
        case 8:
          events.push({ type: "stop", reason: [undefined, "end_turn", "tool_use"][random() % 3] });
          break;
        case 9:
          events.push({ type: "unknown" });
          break;
      }
    }
    await compare(() => events, sample % 2 === 0);
  }
});
