import { expect, it } from "vitest";
import { run, dump, restore } from "./index.js";
import { Budget } from "./interp/budget.js";

it.each([
  { data: "x".repeat(128), limits: { stringLength: 128 }, accepted: true },
  { data: "x".repeat(129), limits: { stringLength: 128 }, accepted: false },
  { data: Array.from({ length: 64 }, () => 1), limits: { arrayLength: 64 }, accepted: true },
  { data: Array.from({ length: 65 }, () => 1), limits: { arrayLength: 64 }, accepted: false }
])("enforces replay input allocation limits %j", async ({ data, limits, accepted }) => {
  const source = "return input.data.length";
  const original = await run(source, { bindings: { input: { data } } });
  const snapshot = restore(JSON.parse(await dump(original)), { source });
  const outcome = await run(source, { snapshot, budget: new Budget(limits) }).then(
    result => result.ok ? { ok: true, value: result.returnValue } : { ok: false, error: result.error },
    error => ({ ok: false, error })
  );
  if (accepted) expect(outcome).toEqual({ ok: true, value: data.length });
  else expect(outcome).toMatchObject({ ok: false, error: { code: "budgetExceeded", budget: Object.keys(limits)[0] } });
});
