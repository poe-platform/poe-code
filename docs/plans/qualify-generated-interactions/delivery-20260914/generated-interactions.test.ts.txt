import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../src/run.js";
import { dump } from "../../src/dump.js";
import { restore } from "../../src/restore.js";
import { Budget } from "../../src/interp/budget.js";
import { createRandom, randomInt } from "./random.js";
import { adversarialFailure } from "./report.js";

const seeds = [0xad5c2026, 0x2622025, 0x51a9cafe];
const cases = seeds.flatMap(seed => {
  const random = createRandom(seed);
  return Array.from({ length: 8 }, (_, index) => ({ seed, index,
    value: 1 + randomInt(random, 8), resize: randomInt(random, 4) }));
});

function budget() {
  return new Budget({ maxSteps: 10_000, maxCallDepth: 32, arrayLength: 128,
    stringLength: 4096, dataSize: 1_000_000, deadline: Date.now() + 500 });
}

async function qualify(source: string, expected: unknown, seed: number, replay = false) {
  try {
    expect(source.length).toBeLessThanOrEqual(2048);
    const pending = run(source, { budget: budget() });
    const completed = pending.catch(error => { throw error; });
    // Only closed guest histories: no host calls, clocks, randomness or weak liveness.
    const original = await completed;
    expect(original).toMatchObject({ ok: true, returnValue: expected });
    const wire = replay ? JSON.parse(await dump(original)) : undefined;
    if (wire) expect(await run(source, { budget: budget(), snapshot: restore(wire, { source }) }))
      .toMatchObject({ ok: true, returnValue: expected });
  } catch (cause) {
    throw new Error(`${adversarialFailure({ cause, kind: "source", seed, value: source }).message}\nFull source:\n${source}`);
  }
}

it.each(cases)("Proxy resize seed=$seed case=$index", async ({ seed, value, resize }) => {
  const source = `const events=[];const a=[${value},2,3,4];
const length=new Proxy({valueOf(){events.push('convert');return ${resize}}},
{get(t,k,r){events.push(String(k));return Reflect.get(t,k,r)}});
a.length=length;return [a.length,events,a.join(',')];`;
  const expected = [resize, ["Symbol(Symbol.toPrimitive)", "valueOf", "convert",
    "Symbol(Symbol.toPrimitive)", "valueOf", "convert"], [value, 2, 3, 4].slice(0, resize).join(",")];
  expect(await runInNewContext(`(async function(){${source}})()`, {}, { timeout: 100 })).toEqual(expected);
  await qualify(source, expected, seed, true);
}, 2000);

it.each(cases)("async disposal finally seed=$seed case=$index", async ({ seed, value, resize }) => {
  const abrupt = resize % 2 === 1;
  const source = `const events=[];async function f(){try{
await using resource={async [Symbol.asyncDispose](){events.push('dispose:start');await 0;events.push('dispose:end')}};
events.push('body');${abrupt ? `throw ${value}` : `return ${value}`};
}finally{events.push('finally');await 0;events.push('finally:end')}}
let result;try{result=await f()}catch(e){result=e}return [result,events];`;
  await qualify(source, [value, ["body", "dispose:start", "dispose:end", "finally", "finally:end"]], seed, true);
}, 2000);

it.each(cases)("eval closure snapshot seed=$seed case=$index", async ({ seed, value, resize }) => {
  const source = `let x=${value};const f=eval("()=>++x");const before=f();await 0;
const values=[];for(let i=0;i<${resize + 1};i++)values.push(f());return [before,x,values];`;
  const expected = [value + 1, value + resize + 2,
    Array.from({ length: resize + 1 }, (_, i) => value + i + 2)];
  expect(await runInNewContext(`(async function(){'use strict';${source}})()`, {}, { timeout: 100 })).toEqual(expected);
  await qualify(source, expected, seed, true);
}, 2000);

it.each(cases)("module cycle TLA seed=$seed case=$index", async ({ seed, value, resize }) => {
  const sources: Record<string, string> = {
    root: `import {read} from 'leaf';export function base(){return ${value}};await 0;export const result=read()+${resize}`,
    leaf: "import {base} from 'root';await 0;export function read(){return base()}"
  };
  // Resolver authority is confined to these two in-memory source IDs.
  const result = await run("import {result} from 'root';export {result}", {
    budget: budget(), sourceType: "module",
    sourceResolver: id => sources[id] === undefined ? undefined : { id, source: sources[id]! }
  });
  expect(result, `seed=${seed}; sources=${JSON.stringify(sources)}`).toMatchObject({ ok: true, returnValue: { result: value + resize } });
}, 2000);

it.each(cases)("weak shared cancellation seed=$seed case=$index", async ({ seed, value }) => {
  const controller = new AbortController();
  const reason = new Error(`seed=${seed}: cancel`);
  const source = `import {stop} from 'cap';const key={};const map=new WeakMap([[key,${value}]]);
const buffer=new SharedArrayBuffer(16);const a=new Int32Array(buffer);const b=new Int32Array(buffer);
a[0]=map.get(key);stop();await 0;return [map.get(key),b[0],a.buffer===b.buffer];`;
  // Passing neighbor differs only in host cancellation. No GC or finalizer oracle.
  await expect(run(source, { budget: budget(), modules: { cap: { stop: () => undefined } } }))
    .resolves.toMatchObject({ ok: true, returnValue: [value, value, true] });
  const limit = budget();
  await expect(run(source, { budget: limit, signal: controller.signal,
    modules: { cap: { stop: () => { controller.abort(reason); } } } }))
    .rejects.toMatchObject({ name: "Error", message: reason.message });
  expect(limit.currentCallDepth).toBe(0);
}, 2000);
