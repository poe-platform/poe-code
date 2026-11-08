import { expect, it, vi } from "vitest";
import { run } from "./run.js";
import { dump } from "./dump.js";
import { Budget } from "./interp/budget.js";

it("keeps same-description symbols and encoded-looking string capabilities distinct on replay", async () => {
  const left = Symbol("key"),
    right = Symbol("key");
  const first = vi.fn(() => 1),
    second = vi.fn(() => 2),
    third = vi.fn(() => 3);
  const value = { left, right, [left]: first, [right]: second, '["symbol",2]': third };
  const source = `return [value[value.left](),value[value.right](),value['["symbol",2]']()];`;
  const result = await run(source, { bindings: { value } });
  expect(result).toMatchObject({ ok: true, returnValue: [1, 2, 3] });
  expect(
    await run(source, { bindings: { value }, snapshot: JSON.parse(await dump(result)) })
  ).toMatchObject({ ok: true, returnValue: [1, 2, 3] });
  for (const fn of [first, second, third]) expect(fn).toHaveBeenCalledOnce();
});

it.each(["object", "array"])(
  "rejects an enumerable symbol accessor on a host %s without reading it",
  async (kind) => {
    const value = kind === "array" ? [] : {};
    const getter = vi.fn(() => 7);
    Object.defineProperty(value, Symbol("key"), { enumerable: true, get: getter });
    await expect(run("return value;", { bindings: { value } })).rejects.toThrow(
      "accessor property"
    );
    expect(getter).not.toHaveBeenCalled();
  }
);

it.each(["object", "array"])("charges imported symbol descriptions on a host %s", async (kind) => {
  const value = kind === "array" ? [] : {};
  Object.defineProperty(value, Symbol("x".repeat(101)), { enumerable: true, value: 7 });
  await expect(
    run("return value;", { bindings: { value }, budget: new Budget({ stringLength: 100 }) })
  ).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
});
