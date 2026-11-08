import { expect, it, vi } from "vitest";
import { run } from "../run.js";

it("keeps a returned runtime snapshot's legitimate intrinsic accessor graph replayable", async () => {
  const source = "const prototype=Map.prototype; prototype.extra=7; return [prototype.extra,new Map().size]";
  const first = await run(source);
  expect(first).toMatchObject({ ok: true, returnValue: [7, 0] });
  expect(await run(source, { snapshot: first.snapshot })).toMatchObject({ ok: true, returnValue: [7, 0] });
});

it("still rejects a caller accessor attached beside legitimate retained guest state", async () => {
  const source = "const prototype=Map.prototype; prototype.extra=7; return prototype.extra";
  const first = await run(source);
  const getter = vi.fn();
  Object.defineProperty(first.snapshot.bindings.prototype, "caller", { get: getter, configurable: true });
  await expect(run(source, { snapshot: first.snapshot })).rejects.toMatchObject({ name: "SnapshotValidationError", code: "invalidType" });
  expect(getter).not.toHaveBeenCalled();
});
