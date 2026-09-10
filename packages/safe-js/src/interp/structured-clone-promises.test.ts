import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { cloneSandboxValue, createSandboxPromise, type SandboxValue } from "./values.js";

it.each(["guest", "host", "foreign"] as const)("rejects %s Promise structured cloning before observable property reads", kind => {
  const native = kind === "foreign" ? runInNewContext("Promise.resolve(1)") : Promise.resolve(1);
  expect(() => structuredClone(native)).toThrow(expect.objectContaining({ name: "DataCloneError" }));
  const value = kind === "guest" ? createSandboxPromise(native) : native;
  let reads = 0;
  if (kind !== "guest") Object.defineProperty(native, "constructor", {
    get() { reads++; return Promise; }
  });
  for (const input of [value, { value }, [value]]) {
    expect(() => cloneSandboxValue(input as SandboxValue, { structuredClone: true }))
      .toThrow(expect.objectContaining({ name: "DataCloneError" }));
  }
  expect(reads).toBe(0);
});

it("retains ordinary guest Promise identity when structured cloning is not requested", () => {
  const promise = createSandboxPromise(Promise.resolve(1));
  expect(cloneSandboxValue(promise)).toBe(promise);
});
