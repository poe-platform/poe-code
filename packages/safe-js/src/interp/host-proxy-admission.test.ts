import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import { deepCopyToSandbox } from "./values.js";

it.each(["copy", "bindings", "returns"])(
  "rejects opaque native proxies through %s without running traps",
  async (path) => {
    const trap = vi.fn(() => {
      throw new Error("host trap executed");
    });
    const value = new Proxy(
      {},
      { has: trap, get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap }
    );
    if (path === "copy") expect(() => deepCopyToSandbox({ value })).toThrow("proxy");
    else
      await expect(
        run(path === "returns" ? "return read();" : "return value;", {
          bindings: path === "returns" ? { read: () => value } : { value }
        })
      ).rejects.toThrow("proxy");
    expect(trap).not.toHaveBeenCalled();
  }
);

it.each([1, 2])(
  "rejects a Proxy hidden %s prototypes above host data without traps",
  async (depth) => {
    const trap = vi.fn(() => {
      throw new Error("prototype trap executed");
    });
    let value = new Proxy({}, { getPrototypeOf: trap, has: trap });
    for (let i = 0; i < depth; i++) value = Object.create(value);
    expect(() => deepCopyToSandbox(value)).toThrow("proxy");
    await expect(run("return read();", { bindings: { read: () => value } })).rejects.toThrow(
      "proxy"
    );
    expect(trap).not.toHaveBeenCalled();
  }
);
