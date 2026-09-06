import { expect, it } from "vitest";
import { run } from "../../run.js";
import { runInNewContext } from "node:vm";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each(["parse", "UTC", "now"])("exposes native own metadata for Date.%s", async method => {
  const source = `return [Object.getOwnPropertyNames(Date.${method}),Object.getOwnPropertyDescriptor(Date.${method},'name'),Object.getOwnPropertyDescriptor(Date.${method},'length')];`;
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it("ignores Date.now arguments before crossing the host clock boundary", async () => {
  const result = await run("return Date.now(Object.create({secret:42}));", { clock: { now: () => 7, snapshot: () => undefined } });
  expect(result.returnValue).toBe(7);
});

it.each(["parse", "UTC", "now"])("allows guest properties on Date.%s", async method => {
  const source = `Object.defineProperty(Date.${method},'label',{value:42});return Date.${method}.label;`;
  expect((await run(source)).returnValue).toEqual(runInNewContext("(function(){" + source + "})()"));
});

it.each(["parse", "UTC", "now"])("supports mutable descriptors and freezing for Date.%s", async method => {
  const source = `Object.defineProperty(Date.${method},'name',{value:'custom'});Date.${method}.label=42;Object.freeze(Date.${method});return [Date.${method}.name,Date.${method}.label,Object.isFrozen(Date.${method}),Object.getOwnPropertyDescriptor(Date.${method},'length')];`;
  expect((await run(source)).returnValue).toEqual(runInNewContext("(function(){" + source + "})()"));
});

it.each(["pending", "completed"])("preserves static Date function properties through %s replay", async mode => {
  const source = "Date.now.label=1;Date.parse.label=2;Date.UTC.label=3;await 0;return [Date.now(),Date.parse('1970-01-01T00:00:00.007Z'),Date.UTC(1970,0,1,0,0,0,7),Date.now.label,Date.parse.label,Date.UTC.label];";
  let calls = 0;
  const clock = { now: () => { calls++; return 7; }, snapshot: () => undefined };
  const expected = { ok: true, returnValue: [7, 7, 7, 1, 2, 3] };
  const pending = run(source, { clock });
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot, clock })).toMatchObject(expected);
    // The pending checkpoint precedes the clock read, so both continuations read it.
    // A completed checkpoint must replay the recorded value without another read.
    expect(calls).toBe(mode === "completed" ? 1 : 2);
  } finally { await completed; }
});

it("keeps Date construction independent of the mutable public Date.now property", async () => {
  const result = await run("Date.now=()=>42;return [Date.now(),new Date().getTime()];", { clock: { now: () => 7, snapshot: () => undefined } });
  expect(result.returnValue).toEqual([42, 7]);
});

it("does not expose host callback properties as mutable guest properties", async () => {
  await expect(run("Object.defineProperty(read,'label',{value:42});", { bindings: { read: () => 7 } })).rejects.toThrow("read only");
});
