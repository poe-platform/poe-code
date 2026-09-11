import { expect, it, vi } from "vitest";
import { run } from "./run.js";
import { dump } from "./dump.js";
import { restore } from "./restore.js";
import { declareHostOperation } from "./interp/host-bridge.js";
import { HostCallJournal } from "./interp/host-call.js";
import { encodeReplayData } from "./snapshot/replay-data.js";
import { serializeSafeJSSnapshot } from "./snapshot/dump-format.js";
import type { SafeJSSnapshot } from "./restore.js";

it.each([
  'function(value){return this.x+value.x}',
  'function(value){return [this===value,this.x]}',
  'new Proxy(function(value){return [this===value,this.x]},{})',
  'new Proxy(function(value){return this.x},{apply(t,r,args){return [r===args[0],Reflect.apply(t,r,args)]}})'
])("preserves host callback receivers and aliases: %s", async expression => {
  const source = `return await host(${expression})`;
  const host = async (callback: unknown) => {
    const receiver = { x: 3 };
    return Reflect.apply(callback as (...args: unknown[]) => unknown, receiver, [receiver]);
  };
  const expected = await new Function("host", `return (async()=>{${source}})()`)(host);
  expect(await run(source, { bindings: { host } })).toMatchObject({ ok: true, returnValue: expected });
});

it.each([null, 0, false, "receiver"])("preserves primitive receiver %s", async receiver => {
  const source = 'return await host(function(){"use strict";return this})';
  const host = async (callback: unknown) => Reflect.apply(callback as () => unknown, receiver, []);
  expect(await run(source, { bindings: { host } })).toMatchObject({ ok: true, returnValue: receiver });
});

it.each(["legacy-version", "false-flag", "empty-input", "undefined-receiver"])("rejects malformed receiver replay: %s", corruption => {
  const journal = new HostCallJournal("source");
  try {
    const record = journal.issue({ moduleId: "host", operation: "callback", argumentDigest: "args", policy: "re-issue" }).record;
    const receiver = { x: 1 };
    journal.recordCallback(record, 1, [receiver, receiver], 1, true);
    const wire = JSON.parse(JSON.stringify(journal.snapshotReplay()));
    if (corruption === "legacy-version") wire.version = 1;
    if (corruption === "false-flag") wire.calls[0].callbacks[0].hasReceiver = false;
    if (corruption === "empty-input") wire.calls[0].callbacks[0].arguments = encodeReplayData([]);
    if (corruption === "undefined-receiver") wire.calls[0].callbacks[0].arguments = encodeReplayData([undefined]);
    expect(() => new HostCallJournal("source", [], undefined, wire)).toThrow("Invalid replay callback");
  } finally { journal.dispose(); }
});

it("keeps argument-only callback replay in version 1", () => {
  const journal = new HostCallJournal("source");
  try {
    const record = journal.issue({ moduleId: "host", operation: "callback", argumentDigest: "args", policy: "re-issue" }).record;
    journal.recordCallback(record, 1, [1], 1);
    const wire = journal.snapshotReplay();
    expect(wire.version).toBe(1);
    expect(wire.calls[0]!.callbacks![0]).not.toHaveProperty("hasReceiver");
    const restored = new HostCallJournal("source", [], undefined, wire);
    restored.dispose();
  } finally { journal.dispose(); }
});

it.each([3, 5])("validates receiver %s when re-issuing a pending callback", async resumedReceiver => {
  const source = 'return await host(async function(amount){await boundary();return this.x+amount})';
  const clock = vi.spyOn(Date, "now").mockReturnValue(0);
  let wire: SafeJSSnapshot | undefined;
  let release!: () => void;
  const makeHost = (x: number) => declareHostOperation(async (callback: unknown) =>
    Reflect.apply(callback as (...args: unknown[]) => unknown, { x }, [4]), "re-issue");
  const pending = run(source, { snapshotIntervalMs: 1, snapshotBackend: {
    async read() { return undefined; },
    async remove() {},
    async write(snapshot) {
      wire = JSON.parse(serializeSafeJSSnapshot(snapshot));
      release?.();
    }
  }, bindings: {
    host: makeHost(3),
    boundary: () => { clock.mockReturnValue(2); return new Promise<void>(resolve => { release = resolve; }); }
  } });
  const completed = pending.catch(error => error);
  try {
    expect(await completed).toMatchObject({ ok: true, returnValue: 7 });
    clock.mockRestore();
    expect(wire).toBeDefined();
    const resumed = run(source, { snapshot: restore(wire!, { source }), bindings: {
      host: makeHost(resumedReceiver), boundary: async () => undefined
    } });
    if (resumedReceiver === 3) expect(await resumed).toMatchObject({ ok: true, returnValue: 7 });
    else await expect(resumed).rejects.toMatchObject({ name: "HostCallResumabilityError", action: "external-reconciliation" });
  } finally { release?.(); clock.mockRestore(); await completed; }
});

it("replays receiver and argument aliases without repeating the host operation", async () => {
  let calls = 0;
  const source = 'const seen=[];await host(function(value){seen.push([this===value,this.x]);this.x++;seen.push(value.x)});return seen';
  const bindings = { host: declareHostOperation(async (callback: unknown) => {
    calls++;
    const value = { x: 3 };
    return Reflect.apply(callback as (...args: unknown[]) => unknown, value, [value]);
  }, "read-side-effect") };
  const pending = run(source, { bindings });
  expect(await pending).toMatchObject({ ok: true, returnValue: [[true, 3], 4] });
  const wire = JSON.parse(await dump(pending));
  expect(wire.replay.version).toBe(2);
  expect(await run(source, { bindings, snapshot: restore(wire, { source }) }))
    .toMatchObject({ ok: true, returnValue: [[true, 3], 4] });
  expect(calls).toBe(1);
});
