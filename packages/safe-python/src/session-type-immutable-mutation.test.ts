import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/type-immutable-mutation-3.14.7.json";

it.each(reference.cases)("matches immutable type mutation precedence: $name", ({ source, expected }) => {
  const session = new PythonSession({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  expect(session.exec(source)).toEqual({ status: "ok" });
  expect(session.eval("repr(result)")).toMatchObject({ status: "ok", value: { primitive: expected } });
});

it("honors cancellation raised by a service during the original name's repr", () => {
  const controller = new AbortController(), output: string[] = [];
  const session = new PythonSession({
    limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 },
    signal: controller.signal,
    hashSeed: [1n, 2n],
    output: { write(value) { output.push(value); controller.abort(); }, flush() {} }
  });
  expect(session.exec("class Name:\n def __repr__(self):\n  print('repr callback')\n  return 'name'\nname=Name()")).toEqual({ status: "ok" });
  expect(session.eval("type.__setattr__(int,name,1)")).toMatchObject({ status: "terminated", reason: "cancelled" });
  expect(output).toEqual(["repr callback"]);
});
