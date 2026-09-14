import { describe, expect, it, vi } from "vitest";
import { run } from "../run.js";
import { deepCopyToSandbox } from "./values.js";

describe("unsupported host value diagnostics", () => {
  it.each(["own", "inherited"])(
    "rejects an %s constructor accessor without reading it",
    (location) => {
      const getter = vi.fn(() => {
        throw new Error("host getter executed");
      });
      const prototype = {};
      const value = Object.create(prototype);
      Object.defineProperty(location === "own" ? value : prototype, "constructor", { get: getter });
      expect(() => deepCopyToSandbox(value)).toThrow("Unsupported sandbox value");
      expect(getter).not.toHaveBeenCalled();
    }
  );

  it.each(["getter", "proxy"])("does not inspect a constructor %s name", (kind) => {
    const getter = vi.fn(() => {
      throw new Error("host name executed");
    });
    const constructor =
      kind === "proxy"
        ? new Proxy(function Host() {}, { getOwnPropertyDescriptor: getter })
        : function Host() {};
    if (kind === "getter") Object.defineProperty(constructor, "name", { get: getter });
    const value = Object.create({ constructor });
    expect(() => deepCopyToSandbox(value)).toThrow("Unsupported sandbox value");
    expect(getter).not.toHaveBeenCalled();
  });

  it("retains a safe class-name diagnostic as a neighboring control", () => {
    class Unsupported {}
    expect(() => deepCopyToSandbox(new Unsupported())).toThrow(
      "Unsupported sandbox value at <root>: Unsupported"
    );
  });

  it.each(["bindings", "modules", "returns"])(
    "does not execute rejection getters through %s",
    async (path) => {
      const getter = vi.fn(() => {
        throw new Error("host getter executed");
      });
      const value = Object.create({});
      Object.defineProperty(value, "constructor", { get: getter });
      const options =
        path === "bindings"
          ? { bindings: { value } }
          : path === "modules"
            ? { modules: { host: { value } } }
            : { bindings: { read: () => value } };
      const source =
        path === "modules"
          ? 'import { value } from "host"; return value;'
          : path === "returns"
            ? "return read();"
            : "return value;";
      const result = await run(source, options).catch((error) => error);
      expect(getter).not.toHaveBeenCalled();
      expect(result).not.toMatchObject({ ok: true });
    }
  );
});
