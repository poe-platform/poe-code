import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/index.js";
import * as reference from "../../toolcraft-design/dist/index.js";

test("command diagnostics preserve text, suggestions and panel defaults in every format", async () => {
  const subpath = await import("toolcraft-design-rust/components/command-errors");
  const originalSubpath = await import("toolcraft-design/components/command-errors");
  assert.deepEqual(Object.keys(subpath), Object.keys(originalSubpath));
  assert.equal(subpath.formatCommandNotFound, native.formatCommandNotFound);
  assert.equal(subpath.formatCommandNotFoundPanel, native.formatCommandNotFoundPanel);
  for (const format of ["terminal", "markdown", "json"]) {
    for (const unknownCommand of ["", "confgure", "one\r\ntwo\nthree\rfour", "`\n## forged", "東京\ud800"]) {
      for (const suggestions of [undefined, [], ["configure"], ["one", "`\n## forged"], [, "visible"]]) {
        const input = { unknownCommand, helpCommand: "tool --help", suggestions };
        for (const name of ["formatCommandNotFound", "formatCommandNotFoundPanel"]) {
          assert.deepEqual(native.withOutputFormat(format, () => native[name](input)), reference.withOutputFormat(format, () => reference[name](input)));
        }
      }
    }
  }
});

test("diagnostics retain accessor order, suggestion methods, receivers and template coercion", () => {
  function run(api, panel) {
    const trace = [];
    const saved = new Map();
    for (const [object, names, prefix] of [[api.text, ["muted", "command", "usageCommand"], "text"], [api.typography, ["bold"], "typography"]]) {
      for (const name of names) {
        saved.set(`${prefix}.${name}`, Object.getOwnPropertyDescriptor(object, name));
        Object.defineProperty(object, name, { configurable: true, get() {
          trace.push(`get ${prefix}.${name}`);
          return function(value) {
            assert.equal(this, object);
            trace.push(`call ${prefix}.${name}:${value}`);
            return { [Symbol.toPrimitive](hint) { trace.push(`coerce ${prefix}.${name}:${hint}`); return value; } };
          };
        } });
      }
    }
    const suggestions = new Proxy(["first", "second"], { get(target, key, receiver) {
      trace.push(`suggestions.${String(key)}`);
      return Reflect.get(target, key, receiver);
    } });
    const input = new Proxy({ unknownCommand: "bad\nname", helpCommand: "help", suggestions, title: "Override" }, {
      get(target, key, receiver) { trace.push(`input.${key}`); return Reflect.get(target, key, receiver); }
    });
    try { return { result: api[panel ? "formatCommandNotFoundPanel" : "formatCommandNotFound"](input), trace }; }
    finally {
      for (const [key, descriptor] of saved) {
        const [prefix, name] = key.split(".");
        Object.defineProperty(api[prefix], name, descriptor);
      }
    }
  }
  for (const panel of [false, true]) assert.deepEqual(run(native, panel), run(reference, panel));
});

test("diagnostics preserve arbitrary thrown values and nested formatter calls", () => {
  for (const failure of [undefined, null, false, "failure", Symbol("failure"), { failed: true }]) {
    for (const name of ["formatCommandNotFound", "formatCommandNotFoundPanel"]) {
      assert.throws(() => native[name]({ get unknownCommand() { throw failure; } }), value => Object.is(value, failure));
    }
  }
  function run(api) {
    let nested;
    const result = api.formatCommandNotFoundPanel({
      unknownCommand: "outer", helpCommand: "help",
      get suggestions() {
        nested = api.withOutputFormat("json", () => api.formatCommandNotFound({ unknownCommand: "inner", helpCommand: "help" }));
        return ["other"];
      },
      title: ""
    });
    return { result, nested };
  }
  assert.deepEqual(run(native), run(reference));
});
