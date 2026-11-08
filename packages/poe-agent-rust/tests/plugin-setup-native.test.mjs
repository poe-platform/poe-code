import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  runPluginSetup,
  createRunContext,
  PluginSetupError,
  PromptTransformError
} from "../dist/index.js";
const native = createRequire(import.meta.url)("../dist/poe-agent-rust.node");
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport("../../poe-agent/src/runtime/plugin-setup.ts", import.meta.url);
const reference = await tsImport("../../poe-agent/src/runtime/run-context.ts", import.meta.url);

test("plugin setup follows live registration, retains active plugins after array removal, and keeps undefined rejection semantics", async () => {
  for (const [setup, contextFactory] of [
    [original.runPluginSetup, reference.createRunContext],
    [runPluginSetup, createRunContext]
  ]) {
    for (const mutate of ["append", "remove", "undefined"]) {
      const effects = [],
        context = contextFactory({ logger: { error() {} } });
      const plugins = [
        {
          name: "first",
          setup() {
            effects.push("first");
            if (mutate === "append")
              plugins.push({
                name: "next",
                setup() {
                  effects.push("next");
                }
              });
            if (mutate === "remove") plugins.length = 0;
            if (mutate === "undefined") throw undefined;
          },
          dispose() {
            effects.push("dispose");
          }
        }
      ];
      await setup(plugins, context);
      await context.dispose();
      assert.deepEqual(
        effects,
        mutate === "append"
          ? ["first", "next", "dispose"]
          : mutate === "remove"
            ? ["first", "dispose"]
            : ["first"]
      );
    }
    const effects = [],
      context = contextFactory({ logger: { error() {} } });
    const plugins = [
      {
        name: "ignored",
        setup() {
          effects.push("ignored");
        }
      }
    ];
    plugins[Symbol.iterator] = function* () {
      yield {
        name: "selected",
        setup() {
          effects.push("selected");
        }
      };
    };
    await setup(plugins, context);
    assert.deepEqual(effects, ["selected"]);
    await context.dispose();
  }
});

test("prompt/setup failures preserve arbitrary causes and retire completed cleanup hooks", async () => {
  const cause = { failed: true },
    context = createRunContext({ logger: { error() {} } });
  let disposals = 0;
  await runPluginSetup(
    [
      {
        name: "prompt",
        prompt() {
          throw cause;
        },
        dispose() {
          disposals++;
        }
      }
    ],
    context
  );
  await assert.rejects(
    context.prompts.compile("request"),
    (error) => error instanceof PromptTransformError && error.cause === cause
  );
  await assert.rejects(
    runPluginSetup(
      [
        {
          name: "broken",
          setup() {
            throw cause;
          }
        }
      ],
      context
    ),
    (error) => error instanceof PluginSetupError && error.cause === cause
  );
  assert.equal(disposals, 1);
  await context.dispose();
  assert.equal(disposals, 1);
});

const format = (kind, value) =>
  kind === "audio"
    ? `[audio: ${value.mimeType}]`
    : kind === "blob"
      ? `[blob: ${value.uri}]`
      : `${value.title ?? value.name}: ${value.uri}`;
const map = (item) => native.mapAgentMcpPart(item, format, (resource) => "text" in resource);
test("native MCP parts preserve inherited payloads, accessor causes, coercion ordering and error shape", () => {
  const payload = { opaque: true };
  assert.equal(map(Object.create({ type: "text", text: payload })).text, payload);
  assert.equal(map({ type: "resource", resource: Object.create({ text: payload }) }).text, payload);
  assert.deepEqual(map({ type: "audio", mimeType: "audio/test\ud800" }), {
    type: "text",
    text: "[audio: audio/test\ud800]"
  });
  assert.deepEqual(map({ type: "resource", resource: { uri: "asset://x" } }), {
    type: "text",
    text: "[blob: asset://x]"
  });
  assert.equal(map({ type: "unknown" }), undefined);
  assert.equal(map({ type: 12 }), undefined);
  const effects = [];
  const link = {
    type: "resource_link",
    get title() {
      effects.push("title");
      return {
        toString() {
          effects.push("coerce");
          return "report";
        }
      };
    },
    get uri() {
      effects.push("uri");
      return "memo://report";
    }
  };
  assert.deepEqual(map(link), { type: "text", text: "report: memo://report" });
  assert.deepEqual(effects, ["title", "coerce", "uri"]);
  for (const cause of [false, 0, "", payload])
    assert.throws(
      () =>
        map({
          type: "image",
          get mimeType() {
            throw cause;
          }
        }),
      (error) => error === cause
    );
  assert.deepEqual(native.agentMcpToolError("failure"), {
    type: "error",
    code: "mcp_tool_error",
    message: "failure",
    retriable: false
  });
});
