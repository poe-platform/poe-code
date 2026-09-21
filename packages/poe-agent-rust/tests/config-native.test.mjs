import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/config.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport("../../poe-agent/src/runtime/config.ts", import.meta.url);
const outcome = (fn, value) => {
  try {
    return { value: fn(value) };
  } catch (error) {
    return { message: error.message, name: error.name };
  }
};
test("configuration clones and freezes plugin schemas, hooks, dependency aliases and MCP fields", () => {
  const execute = async () => "ok",
    setup = async () => {},
    hook = () => {};
  const input = {
    model: " model ",
    plugins: [
      {
        name: " plugin ",
        dependencies: [" a ", "", null, "a"],
        dependsOn: ["b", "a"],
        tools: [
          { name: "t", inputSchema: JSON.parse('{"__proto__":{"items":[1,"\\ud800"]}}'), execute }
        ],
        hooks: { onStart: hook },
        setup
      }
    ]
  };
  assert.deepEqual(own.createResolvedAgentConfig(input), original.createResolvedAgentConfig(input));
  const result = own.createResolvedAgentConfig(input);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.plugins), true);
  assert.equal(Object.isFrozen(result.plugins[0]), true);
  assert.equal(Object.isFrozen(result.plugins[0].tools[0]), true);
  result.plugins[0].tools[0].inputSchema.__proto__.items.push(2);
  assert.deepEqual(input.plugins[0].tools[0].inputSchema.__proto__.items, [1, "\ud800"]);
  assert.equal(result.plugins[0].tools[0].execute, execute);
  for (const value of [
    { name: " server ", command: " node ", args: ["x"], env: { A: "b" }, timeout: 1 },
    { name: " ", command: "node" },
    { name: "s", command: " " }
  ])
    assert.deepEqual(
      outcome(own.cloneMcpServerConfig, value),
      outcome(original.cloneMcpServerConfig, value)
    );
  for (const value of [
    undefined,
    {},
    { model: "" },
    { model: null },
    { plugins: [{ name: "" }] },
    { plugins: [{ name: "\ud800" }] }
  ])
    assert.deepEqual(
      outcome(own.createResolvedAgentConfig, value),
      outcome(original.createResolvedAgentConfig, value)
    );
});
test("dependency traversal compares stable order and complete malformed graph diagnostics", () => {
  const fixtures = [
    [{ name: "b", dependsOn: ["a"] }, { name: "a" }],
    [{ name: "a" }, { name: " a " }],
    [{ name: "a", dependencies: ["a"] }],
    [{ name: "a", dependencies: ["b"] }],
    [
      { name: "a", dependencies: ["b"] },
      { name: "b", dependencies: ["a"] }
    ],
    [{ name: "a", dependencies: ["b", "c"] }, { name: "b", dependencies: ["c"] }, { name: "c" }],
    [{ name: "" }]
  ];
  let seed = 0x142536;
  for (let sample = 0; sample < 512; sample++) {
    const plugins = Array.from({ length: 12 }, (_, index) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return {
        name: "p" + index,
        dependencies: [" p" + (seed % 14) + " ", seed % 3 === 0 ? "" : "p" + ((seed >>> 8) % 14)],
        dependsOn: seed % 5 === 0 ? ["p" + ((seed >>> 16) % 14), null] : []
      };
    });
    fixtures.push(plugins);
  }
  for (const plugins of fixtures)
    assert.deepEqual(
      outcome(own.resolvePluginSetupOrder, plugins),
      outcome(original.resolvePluginSetupOrder, plugins)
    );
  const plugins = [{ name: "a" }, { name: "b", dependencies: ["a"] }];
  assert.equal(own.resolvePluginSetupOrder(plugins)[1], plugins[1]);
});
test("duplicate admission and dependency loading preserve lazy getter effects", () => {
  for (const api of [original, own]) {
    const events = [],
      make = (name) => ({
        get name() {
          events.push("name:" + name);
          return name;
        },
        get dependencies() {
          events.push("deps:" + name);
          return [];
        },
        get dependsOn() {
          events.push("alias:" + name);
          return [];
        }
      });
    assert.throws(
      () => api.resolvePluginSetupOrder([make("a"), make("a"), make("never")]),
      /Duplicate plugin/
    );
    assert.deepEqual(events, ["name:a", "name:a"]);
    events.length = 0;
    const plugins = [make("a"), make("b")];
    api.resolvePluginSetupOrder(plugins);
    assert.deepEqual(events, [
      "name:a",
      "name:b",
      "name:a",
      "deps:a",
      "alias:a",
      "name:b",
      "deps:b",
      "alias:b"
    ]);
  }
});
