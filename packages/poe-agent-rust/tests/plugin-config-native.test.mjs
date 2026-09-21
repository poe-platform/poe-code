import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/resolve-plugins.js";
import * as reference from "../../poe-agent/dist/plugins/resolve-plugins.js";
import { builtinPluginRegistry } from "../dist/plugin-registry.js";
import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("../dist/poe-agent-rust.node");
const result = (fn) => {
  try {
    return { value: fn() };
  } catch (error) {
    return { name: error.name, message: error.message };
  }
};
test("plugin config parsing and diagnostics agree on inherited, special, sparse and malformed entries", () => {
  const cases = [
    null,
    undefined,
    0,
    {},
    [],
    [null],
    [{}],
    [{ name: "web", extra: true }],
    [{ name: "  web  ", options: null }],
    [{ name: "shel" }],
    [{ name: "unknown🌍\ud800" }],
    [{ name: "web" }, { name: "web" }],
    [{ name: "compaction", options: { threshold: "bad" } }],
    Array(2),
    [Object.create({ name: "web" })]
  ];
  for (const input of cases) {
    assert.deepEqual(
      result(() => own.parsePluginConfigEntries(input)),
      result(() => reference.parsePluginConfigEntries(input))
    );
    assert.deepEqual(
      result(() => own.resolvePluginsFromConfig(input).map((p) => p.name)),
      result(() => reference.resolvePluginsFromConfig(input).map((p) => p.name))
    );
  }
  for (const spec of builtinPluginRegistry.values()) assert.equal(Object.isFrozen(spec), true);
  assert.equal(builtinPluginRegistry.size, 9);
});
test("Rust edit distances agree with independent JavaScript UTF16 dynamic programming", () => {
  const distance = (left, right) => {
    let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
    for (let i = 0; i < left.length; i++) {
      const next = [i + 1];
      for (let j = 0; j < right.length; j++)
        next.push(
          Math.min(previous[j] + Number(left[i] !== right[j]), previous[j + 1] + 1, next[j] + 1)
        );
      previous = next;
    }
    return previous[right.length];
  };
  const alphabet = ["a", "b", "🌍", "\ud800", "\udfff"],
    values = ["", "web", "shel", "memory"];
  let seed = 12345;
  for (let n = 0; n < 128; n++) {
    let word = "";
    for (let i = 0; i < n % 16; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      word += alphabet[seed % alphabet.length];
    }
    values.push(word);
  }
  for (const name of values)
    assert.deepEqual(
      native.agentPluginDistances(name, values),
      values.map((candidate) => distance(name, candidate))
    );
});
