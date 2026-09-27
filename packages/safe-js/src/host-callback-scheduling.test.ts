import { expect, it, vi } from "vitest";
import { defineExtension } from "./extensions.js";
import { run } from "./run.js";
import { dump } from "./dump.js";
import { restore, type SafeJSSnapshot } from "./restore.js";
import { serializeSafeJSSnapshot } from "./snapshot/dump-format.js";
import { declareHostOperation } from "./interp/host-bridge.js";

for (const realm of [false, true]) {
  const mode = realm ? { extensions: [] } : {};
  it(`queues admitted callbacks after synchronous work (realm=${realm})`, async () => {
    const seen: unknown[] = [];
    const result = await run(`
      let finish;
      const completion = new Promise(resolve => { finish = resolve; });
      admit(() => { mark("callback"); finish(); });
      let count = 0; while (count < 1000) count++;
      mark("prefix");
      await completion;
    `, { ...mode, bindings: {
      admit: declareHostOperation((callback: () => Promise<unknown>) => { void callback(); }, "read-side-effect", { callbackScheduling: "after-prefix" }),
      mark: (value: unknown) => { seen.push(value); }
    } });
    expect(result.ok).toBe(true);
    expect(seen).toEqual(["prefix", "callback"]);
  });

  it(`releases an async callback prefix for another callback (realm=${realm})`, async () => {
    const seen: unknown[] = [];
    const result = await run(`
      await new Promise(resolve => admit(async () => {
        mark("outer");
        await new Promise(inner => admit(() => { mark("inner"); inner(); }));
        mark("tail"); resolve();
      }));
    `, { ...mode, bindings: {
      admit: declareHostOperation((callback: () => Promise<unknown>) => { void callback(); }, "read-side-effect", { callbackScheduling: "after-prefix" }),
      mark: (value: unknown) => { seen.push(value); }
    } });
    expect(result.ok).toBe(true);
    expect(seen).toEqual(["outer", "inner", "tail"]);
  });

  it(`preserves default inline host callbacks and awaited nesting (realm=${realm})`, async () => {
    const seen: unknown[] = [];
    const result = await run(`
      await inline(() => mark("inline"));
      await nested(async () => { await Promise.resolve(); mark("nested"); });
      mark("end");
    `, { ...mode, bindings: {
      inline: declareHostOperation((callback: () => Promise<unknown>) => callback(), "read-side-effect"),
      nested: declareHostOperation(async (callback: () => Promise<unknown>) => { await Promise.resolve(); return callback(); }, "read-side-effect"),
      mark: (value: unknown) => { seen.push(value); }
    } });
    expect(result.ok).toBe(true);
    expect(seen).toEqual(["inline", "nested", "end"]);
  });

  it.each([false, null, 0, ""])(`rejects queued entry with exact cancellation %j (realm=${realm})`, async reason => {
    const controller = new AbortController();
    let completion: Promise<unknown> | undefined;
    let called = false;
    const result = run(`admit(() => mark()); stop(); await Promise.resolve();`, { ...mode, signal: controller.signal, bindings: {
      admit: declareHostOperation((callback: () => Promise<unknown>) => {
        completion = callback();
        void completion.catch(() => undefined);
      }, "read-side-effect", { callbackScheduling: "after-prefix" }),
      stop: () => controller.abort(reason),
      mark: () => { called = true; }
    } });
    await result.catch(() => undefined);
    await expect(completion).rejects.toBe(reason);
    expect(called).toBe(false);
  });
}

it("preserves receiver aliases and journals queued callback replay", async () => {
  let calls = 0;
  const source = 'const seen=[];await host(function(value){seen.push([this===value,this.x]);this.x++;seen.push(value.x)});return seen';
  const bindings = { host: declareHostOperation((callback: (...args: unknown[]) => Promise<unknown>) => {
    calls++;
    const receiver = { x: 3 };
    return Reflect.apply(callback, receiver, [receiver]);
  }, "read-side-effect", { callbackScheduling: "after-prefix" }) };
  const pending = run(source, { bindings });
  expect(await pending).toMatchObject({ ok: true, returnValue: [[true, 3], 4] });
  const wire = JSON.parse(await dump(pending));
  expect(await run(source, { bindings, snapshot: restore(wire, { source }) })).toMatchObject({ ok: true, returnValue: [[true, 3], 4] });
  expect(calls).toBe(1);
});

it("rejects scheduling that would wait on its own held prefix", () => {
  expect(() => declareHostOperation(() => {}, "read-side-effect", { awaitResult: true, callbackScheduling: "after-prefix" })).toThrow("awaitResult");
});

it("restores a pending queued callback with its receiver and arguments", async () => {
  const source = 'return await host(async function(amount){await boundary();return this.x+amount})';
  const clock = vi.spyOn(Date, "now").mockReturnValue(0);
  let wire: SafeJSSnapshot | undefined;
  let release: (() => void) | undefined;
  const host = declareHostOperation((callback: (...args: unknown[]) => Promise<unknown>) =>
    Reflect.apply(callback, { x: 3 }, [4]), "re-issue", { callbackScheduling: "after-prefix" });
  const pending = run(source, { snapshotIntervalMs: 1, snapshotBackend: {
    async read() { return undefined; }, async remove() {},
    async write(snapshot) { wire = JSON.parse(serializeSafeJSSnapshot(snapshot)); release?.(); }
  }, bindings: {
    host, boundary: () => { clock.mockReturnValue(2); return new Promise<void>(resolve => { release = resolve; }); }
  } });
  try {
    expect(await pending).toMatchObject({ ok: true, returnValue: 7 });
    clock.mockRestore();
    expect(wire).toBeDefined();
    expect(await run(source, { snapshot: restore(wire!, { source }), bindings: {
      host, boundary: async () => undefined
    } })).toMatchObject({ ok: true, returnValue: 7 });
  } finally { release?.(); clock.mockRestore(); await pending; }
});

it("preserves legacy awaited host callbacks without opting in", async () => {
  const source = 'const result = host(() => 42); return result;';
  const result = await run(source, { bindings: {
    host: declareHostOperation((callback: () => Promise<unknown>) => callback(), "read-side-effect", { awaitResult: true })
  } });
  expect(result).toMatchObject({ ok: true, returnValue: 42 });
});

it("rejects queued callbacks made implicitly awaited by a nested operation", async () => {
  await expect(run('host(() => 1);', {
    grants: ["source:nested"], extensions: [defineExtension({
      manifest: { version: 1, name: "queued-nested", capabilities: ["source:nested"], globals: ["host"] },
      setup(context) {
        return { globals: { host: context.nestedOperation(declareHostOperation(
          (callback: () => Promise<unknown>) => callback(), "read-side-effect", { callbackScheduling: "after-prefix" }
        )) } };
      }
    })]
  })).rejects.toThrow("nestedOperation");
});
