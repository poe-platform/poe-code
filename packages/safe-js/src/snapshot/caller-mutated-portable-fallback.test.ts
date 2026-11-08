import { expect, it } from "vitest";
import { restore } from "../restore.js";
import { run } from "../run.js";

it.each(["extra getter", "non-enumerable getter", "guest object getter", "extra Proxy"])(
  "rejects a caller %s before portable conversion, then preserves graph identity on recovery",
  async kind => {
    const source = 'effect(); const a = {}; Object.defineProperty(a, "x", { value: 1 }); a.self = a; return [a, a];';
    let hostCalls = 0;
    const effect = () => ++hostCalls;
    const result = await run(source, { bindings: { effect } });
    expect(result.ok).toBe(true);
    let invocations = 0;
    const get = () => ++invocations;
    const guest = (result.snapshot.bindings as Record<string, unknown>).a as object;
    const target = kind === "guest object getter" ? guest : result.snapshot;
    const key = kind === "guest object getter" ? "caller" : "extra";
    Object.defineProperty(target, key, { configurable: true, enumerable: true,
      ...(kind === "guest object getter" ? { get } : {
        value: kind === "extra Proxy" ? new Proxy({}, { get, ownKeys: () => { get(); return []; } })
          : Object.defineProperty({}, "value", { get, enumerable: kind !== "non-enumerable getter" })
      })
    });
    hostCalls = 0;
    for (const boundary of [
      () => restore(result.snapshot, { source }),
      () => run(source, { snapshot: result.snapshot, bindings: { effect } })
    ]) {
      let rejected: unknown;
      try { await boundary(); } catch (error) { rejected = error; }
      expect(invocations).toBe(0);
      expect(hostCalls).toBe(0);
      expect(rejected).toMatchObject({ name: "SnapshotValidationError", code: "invalidType" });
    }
    Reflect.deleteProperty(target, key);
    const recovered = await run(source, { snapshot: result.snapshot, bindings: { effect } });
    expect(recovered.ok).toBe(true);
    const value = recovered.returnValue as unknown as Array<Record<string, unknown>>;
    expect(value[0]).toBe(value[1]);
    expect(value[0].self).toBe(value[0]);
    expect(value[0].x).toBe(1);
    expect(hostCalls).toBe(0);
    expect(invocations).toBe(0);
  }
);
