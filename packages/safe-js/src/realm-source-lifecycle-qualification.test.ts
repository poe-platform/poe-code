import { expect, it, vi } from "vitest";
import { Budget, createRealm } from "./core.js";
import type { SourceModule } from "./modules/source-graph.js";

it("rejects concurrent evaluation and discards late source resolution after close", async () => {
  let started!: () => void;
  let resolve!: (source: SourceModule) => void;
  const ready = new Promise<void>(yes => { started = yes; });
  const pending = new Promise<SourceModule>(yes => { resolve = yes; });
  const effect = vi.fn();
  const budget = new Budget();
  const realm = createRealm({ budget, bindings: { effect }, sourceResolver: () => { started(); return pending; } });
  const other = createRealm();
  const execution = realm.evaluate("import 'pending'; export const done=true", { sourceType: "module" });
  const failure = expect(execution).rejects.toThrow("closed");
  try {
    await ready;
    await expect(realm.evaluate("return 1")).rejects.toMatchObject({ code: "reentry" });
    await realm.close(); await failure;
    expect([...budget.retainedValues()]).toEqual([]);
    expect(budget.currentDataSize).toBe(0);
    resolve({ id: "pending", source: "effect(); export const value=7" });
    await pending;
    await new Promise<void>(yes => setImmediate(yes));
    expect(effect).not.toHaveBeenCalled();
    expect([...budget.retainedValues()]).toEqual([]);
    expect(budget.currentDataSize).toBe(0);
    expect(await other.evaluate("return 9")).toMatchObject({ ok: true, returnValue: 9 });
  } finally { await realm.close(); await other.close(); }
});
