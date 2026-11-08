import { expect, it } from "vitest";
import { run, dump, restore } from "../index.js";
import { Budget } from "./budget.js";

for (const mode of ["import", "replay"] as const) {
  it.each([
    { name: "string at limit", data: "x".repeat(128), limits: { stringLength: 128 }, accepted: true },
    { name: "string beyond limit", data: "x".repeat(129), limits: { stringLength: 128 }, accepted: false },
    { name: "array at limit", data: Array.from({ length: 64 }, () => 1), limits: { arrayLength: 64 }, accepted: true },
    { name: "array beyond limit", data: Array.from({ length: 65 }, () => 1), limits: { arrayLength: 64 }, accepted: false }
  ])(`${mode} enforces Promise property limits: $name`, async ({ data, limits, accepted }) => {
    const input = Object.assign(Promise.resolve(7), { data });
    const source = "await input; return input.data.length";
    const snapshot = mode === "replay"
      ? restore(JSON.parse(await dump(await run(source, { bindings: { input } }))), { source }) : undefined;
    const outcome = await run(source, { bindings: mode === "import" ? { input } : undefined,
      snapshot, budget: new Budget(limits) }).then(
      result => result.ok ? { ok: true, value: result.returnValue } : { ok: false, error: result.error },
      error => ({ ok: false, error })
    );
    if (accepted) expect(outcome).toEqual({ ok: true, value: data.length });
    else expect(outcome).toMatchObject({ ok: false, error: { code: "budgetExceeded", budget: Object.keys(limits)[0] } });
  });
}
