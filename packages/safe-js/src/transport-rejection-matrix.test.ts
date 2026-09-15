import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { createRealm } from "./realm.js";
import { run } from "./run.js";
import { deepCopyToSandbox } from "./interp/values.js";

const unsupported = [
  { name: "foreign Map", make: () => runInNewContext("new Map()") },
  { name: "foreign Set", make: () => runInNewContext("new Set()") },
  {
    name: "Map subclass",
    make: () => new (class extends Map {})(),
    error: "Map subclasses are not supported"
  },
  {
    name: "Set subclass",
    make: () => new (class extends Set {})(),
    error: "Set subclasses are not supported"
  },
  {
    name: "Date subclass",
    make: () => new (class extends Date {})(),
    error: "Date subclasses are not supported"
  },
  {
    name: "foreign Date",
    make: () => runInNewContext("new Date()"),
    error: "Date subclasses are not supported"
  },
  { name: "opaque Proxy", make: () => new Proxy({}, {}), error: "Unsupported proxy sandbox value" },
  {
    name: "revoked Proxy",
    make: () => {
      const pair = Proxy.revocable({}, {});
      pair.revoke();
      return pair.proxy;
    },
    error: "Unsupported proxy sandbox value"
  },
  { name: "class instance", make: () => new (class Unsupported {})() },
  { name: "foreign class instance", make: () => runInNewContext("new (class Unsupported {})()") },
  { name: "WeakMap", make: () => new WeakMap() },
  { name: "WeakSet", make: () => new WeakSet() },
  { name: "WeakRef", make: () => new WeakRef({}) },
  { name: "FinalizationRegistry", make: () => new FinalizationRegistry(() => {}) },
  { name: "native array iterator", make: () => [1].values() },
  { name: "native Map iterator", make: () => new Map([[1, 2]]).values() },
  { name: "native Set iterator", make: () => new Set([1]).values() },
  {
    name: "native generator",
    make: () =>
      (function* () {
        yield 1;
      })()
  },
  {
    name: "native async generator",
    make: () =>
      (async function* () {
        yield 1;
      })()
  },
  { name: "native Intl formatter", make: () => new Intl.NumberFormat("en-US") }
];

describe.each(["copy", "bindings", "modules", "returns", "realm"] as const)(
  "unsupported transport: %s",
  (path) => {
    it.each(unsupported)("rejects $name", async (category) => {
      const { make } = category;
      const error = "error" in category ? category.error : "Unsupported sandbox value";
      const value = make();
      if (path === "copy") {
        expect(() => deepCopyToSandbox(value)).toThrow(TypeError);
        return;
      }
      if (path === "realm") {
        const realm = createRealm({ bindings: { value } });
        try {
          await expect(realm.evaluate("return value;")).rejects.toThrow(error);
        } finally {
          await realm.close();
        }
        return;
      }
      const options =
        path === "modules"
          ? { modules: { host: { value } } }
          : path === "returns"
            ? { bindings: { read: () => value } }
            : { bindings: { value } };
      const source =
        path === "modules"
          ? 'import { value } from "host"; return value;'
          : path === "returns"
            ? "return read();"
            : "return value;";
      await expect(run(source, options)).rejects.toThrow(error);
    });
  }
);
