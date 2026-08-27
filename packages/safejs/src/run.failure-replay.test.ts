import { describe, expect, it, vi } from "vitest";

import { dump } from "./dump.js";
import { Budget } from "./interp/budget.js";
import { runResources } from "./interp/resources.js";
import { run } from "./run.js";
import { restore } from "./restore.js";

describe("failed run recovery checkpoints", () => {
  it.each([
    'await effect(); throw new Error("failed");',
    'export default function () { effect(); throw new Error("failed"); }',
    'export default async function () { await effect(); throw new Error("failed"); }'
  ])("preserves completed effects in failures: %s", async (source) => {
    const effect = vi.fn(() => "done");
    const execution = run(source, { bindings: { effect }, entryPointArgs: [] });
    await expect(execution).rejects.toThrow("failed");
    await expect(dump(execution)).rejects.toThrow("failed");
    const snapshot = restore(JSON.parse(await dump(execution, { onFailure: "checkpoint" })), {
      source
    });
    expect(snapshot).toHaveProperty("replay");
    expect(snapshot).toHaveProperty("initialInputs");
    expect(snapshot).toHaveProperty("promiseReplay");
    const resumed = run(source, { bindings: { effect }, entryPointArgs: [], snapshot });
    await expect(resumed).rejects.toThrow("failed");
    expect(effect).toHaveBeenCalledOnce();
  });

  it("does not fall back to a checkpoint preceding completed effects", async () => {
    const effect = vi.fn(() => "done");
    const pause = vi.fn(async () => undefined);
    const source = 'await pause(); effect(); throw new Error("failed");';
    const execution = run(source, { bindings: { effect, pause } });
    const early = dump(execution);
    await expect(execution).rejects.toThrow("failed");
    await early;
    const snapshot = restore(JSON.parse(await dump(execution, { onFailure: "checkpoint" })), {
      source
    });
    await expect(run(source, { bindings: { effect, pause }, snapshot })).rejects.toThrow("failed");
    expect(effect).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledOnce();
  });

  it("requires the host to raise an exhausted budget before recovery", async () => {
    const effect = vi.fn(() => "done");
    const escaped = vi.fn();
    const source =
      "effect(); let total = 0; try { for(let index=0; index<50; index++) total += index; } catch(error) { escaped(); } return total;";
    const execution = run(source, {
      bindings: { effect, escaped },
      budget: new Budget({ maxSteps: 45 })
    });
    await expect(execution).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    const snapshot = restore(JSON.parse(await dump(execution, { onFailure: "checkpoint" })), {
      source
    });
    await expect(
      run(source, {
        bindings: { effect, escaped },
        snapshot,
        budget: new Budget({ maxSteps: 45 })
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    await expect(
      run(source, {
        bindings: { effect, escaped },
        snapshot,
        budget: new Budget({ maxSteps: 5000 })
      })
    ).resolves.toMatchObject({ ok: true, returnValue: 1225 });
    expect(effect).toHaveBeenCalledOnce();
    expect(escaped).not.toHaveBeenCalled();
  });

  it("refuses recovery when parsing fails before execution", async () => {
    const execution = run("const = ;");
    await expect(execution).rejects.toThrow();
    await expect(dump(execution, { onFailure: "checkpoint" })).rejects.toThrow();
  });

  it("rejects checkpoint requests after replay initialization fails", async () => {
    const execution = run("return 1;", {
      snapshot: { sourceHash: "invalid", promiseReplay: { version: 999 } }
    });
    await expect(execution).rejects.toThrow();
    await expect(dump(execution, { onFailure: "checkpoint" })).rejects.toThrow();
  });

  it.each([
    {
      name: "callDepth",
      limits: { maxCallDepth: 8 },
      body: "function count(value) { return value === 0 ? 0 : 1 + count(value - 1); } return count(20);",
      expected: 20
    },
    {
      name: "stringLength",
      limits: { stringLength: 12 },
      body: 'return "x".repeat(40).length;',
      expected: 40
    },
    {
      name: "arrayLength",
      limits: { arrayLength: 12 },
      body: "return Array.from({length: 40}, (_, index) => index).length;",
      expected: 40
    },
    {
      name: "dataSize",
      limits: { dataSize: 150 },
      body: "return Array.from({length: 300}, (_, index) => index).length;",
      expected: 300
    }
  ])(
    "recovers $name only with an explicit larger host budget",
    async ({ name, limits, body, expected }) => {
      let effects = 0;
      let escapes = 0;
      const effect = () => {
        effects += 1;
        return "done";
      };
      const escaped = () => {
        escapes += 1;
      };
      const source = `effect(); try { ${body} } catch(error) { escaped(); }`;
      const execution = run(source, { bindings: { effect, escaped }, budget: new Budget(limits) });
      await expect(execution).rejects.toMatchObject({ code: "budgetExceeded", budget: name });
      await expect(dump(execution, { onFailure: "throw" })).rejects.toMatchObject({
        code: "budgetExceeded",
        budget: name
      });
      const snapshot = restore(JSON.parse(await dump(execution, { onFailure: "checkpoint" })), {
        source
      });
      await expect(
        run(source, { bindings: { effect, escaped }, snapshot, budget: new Budget(limits) })
      ).rejects.toMatchObject({ code: "budgetExceeded", budget: name });
      await expect(
        run(source, {
          bindings: { effect, escaped },
          snapshot,
          budget: new Budget({
            maxSteps: 10000,
            dataSize: 10000,
            stringLength: 1000,
            arrayLength: 1000,
            maxCallDepth: 100
          })
        })
      ).resolves.toMatchObject({ ok: true, returnValue: expected });
      expect(effects).toBe(1);
      expect(escapes).toBe(0);
    }
  );

  it("waits for resource cleanup before returning a recoverable failure", async () => {
    const close = vi.fn(async () => undefined);
    const effect = vi.fn(() => {
      runResources.getStore()!.add(close);
      return "done";
    });
    const execution = run('effect(); throw new Error("failed");', { bindings: { effect } });
    await expect(execution).rejects.toThrow("failed");
    expect(close).toHaveBeenCalledOnce();
    await expect(dump(execution, { onFailure: "checkpoint" })).resolves.toContain('"replay"');
  });

  it("keeps the memory checkpoint available if durable storage fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const execution = run('throw new Error("failed");', {
        snapshotBackend: {
          async read() {
            return undefined;
          },
          async remove() {},
          async write() {
            throw new Error("disk full");
          }
        }
      });
      await expect(execution).rejects.toThrow("failed");
      await expect(dump(execution, { onFailure: "checkpoint" })).resolves.toContain('"replay"');
      expect(warning).toHaveBeenCalledWith(
        "Failed to write failure snapshot.",
        expect.objectContaining({ message: "disk full" })
      );
    } finally {
      warning.mockRestore();
    }
  });

  it("applies the failure policy after resource cleanup rejects", async () => {
    let effects = 0;
    const write = vi.fn(async () => undefined);
    const close = vi.fn(async () => {
      throw new Error("close failed");
    });
    const bindings = {
      effect() {
        effects += 1;
        runResources.getStore()!.add(close);
      }
    };
    const source = "effect(); return 1;";
    const execution = run(source, {
      bindings,
      snapshotBackend: {
        async read() {
          return undefined;
        },
        async remove() {},
        write
      }
    });
    await expect(execution).rejects.toThrow("SafeJS resource cleanup failed.");
    await expect(dump(execution, { onFailure: "throw" })).rejects.toThrow(
      "SafeJS resource cleanup failed."
    );
    const snapshot = JSON.parse(await dump(execution, { onFailure: "checkpoint" }));
    await expect(run(source, { bindings, snapshot })).resolves.toMatchObject({
      ok: true,
      returnValue: 1
    });
    expect(effects).toBe(1);
    expect(close).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ replay: expect.any(Object), initialInputs: expect.any(Object) })
    );
  });

  it("requires a new host deadline without repeating effects", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(10000);
      let effects = 0;
      const effect = () => {
        effects += 1;
        vi.setSystemTime(12000);
      };
      const source =
        "effect(); let total=0; for(let index=0; index<2000; index++) total += index; return total;";
      const execution = run(source, {
        bindings: { effect },
        budget: new Budget({ deadline: 11000 })
      });
      await expect(execution).rejects.toMatchObject({ code: "budgetExceeded", budget: "deadline" });
      const snapshot = restore(JSON.parse(await dump(execution, { onFailure: "checkpoint" })), {
        source
      });
      await expect(
        run(source, { bindings: { effect }, snapshot, budget: new Budget({ deadline: 13000 }) })
      ).resolves.toMatchObject({ ok: true, returnValue: 1999000 });
      expect(effects).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers repeated budget failures inside promise handlers without stalling", async () => {
    const source =
      "effect(); return await Promise.resolve().then(async()=>{let total=0;for(let index=0;index<16;index++)total+=index;return total;}).catch(()=>-1);";
    let effects = 0;
    const bindings = {
      effect: () => {
        effects += 1;
      }
    };
    let snapshot;
    for (let attempt = 0; attempt < 2; attempt++) {
      const failed = run(source, { bindings, snapshot, budget: new Budget({ maxSteps: 77 }) });
      await expect(failed).rejects.toMatchObject({ code: "budgetExceeded" });
      snapshot = JSON.parse(await dump(failed, { onFailure: "checkpoint" }));
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(
        Promise.race([
          run(source, { bindings, snapshot, budget: new Budget({ maxSteps: 5000 }) }),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error("Replay stalled")), 100);
          })
        ])
      ).resolves.toMatchObject({ ok: true, returnValue: 120 });
      expect(effects).toBe(1);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("never returns an earlier checkpoint when the current replay is unavailable", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const source = 'await pause(); const capability = await load(); throw new Error("failed");';
      const execution = run(source, {
        bindings: { pause: async () => undefined, load: async () => () => 1 }
      });
      const early = dump(execution);
      await expect(execution).rejects.toThrow("failed");
      await early;
      await expect(dump(execution, { onFailure: "checkpoint" })).rejects.toThrow("failed");
    } finally {
      warning.mockRestore();
    }
  });
});
