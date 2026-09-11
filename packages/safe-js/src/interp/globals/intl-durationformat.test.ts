import { expect, it } from "vitest";
import { run } from "../../run.js";
import { isSandboxClosure, measureSandboxData } from "../values.js";
import { durationFormatState } from "../intl-durationformat.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { serialize, type RuntimeSnapshotValue } from "../../snapshot/serialize.js";
import { restore as restoreHeap } from "../../snapshot/restore.js";
import { Budget } from "../budget.js";

it.each([
  ["return new Intl.DurationFormat('en',{style:'digital'}).format({hours:1,minutes:2,seconds:3})", "1:02:03"],
  ["return new Intl.DurationFormat('en',{style:'digital',fractionalDigits:2}).format({seconds:1,milliseconds:999})", "0:00:01.99"],
  ["return new Intl.DurationFormat('en',{style:'digital',fractionalDigits:2}).format({hours:-1,minutes:-2})", "-1:02:00.00"],
  ["return new Intl.DurationFormat('en',{style:'long'}).format({hours:-1,minutes:-2})", "-1 hour, 2 minutes"],
  ["return new Intl.DurationFormat('en',{style:'long'}).format({milliseconds:1,microseconds:2,nanoseconds:3})", "1 millisecond, 2 microseconds, 3 nanoseconds"],
  ["return new Intl.DurationFormat('en',{style:'digital',minutesDisplay:'auto'}).format({hours:1,seconds:3})", "1:00:03"],
  ["return new Intl.DurationFormat('en',{style:'digital'}).format({seconds:-3})", "-0:00:03"],
  ["return new Intl.DurationFormat('en',{style:'digital',fractionalDigits:0}).format({milliseconds:-1})", "-0:00:00"],
  ["return new Intl.DurationFormat('en',{style:'digital'}).format({hours:1234})", "1234:00:00"],
  ["return new Intl.DurationFormat('en',{style:'long',hoursDisplay:'always'}).format({minutes:-2})", "-0 hours, 2 minutes"],
  ["return new Intl.DurationFormat('en',{style:'long',numberingSystem:'foobar'}).format({seconds:1})", "1 second"],
  ["try{Intl.DurationFormat('en')}catch(e){return e.name}", "TypeError"],
  ["try{new Intl.DurationFormat('en').format({seconds:1n})}catch(e){return e.name}", "TypeError"],
  ["try{new Intl.DurationFormat('en').format({seconds:1.5})}catch(e){return e.name}", "RangeError"],
  ["try{new Intl.DurationFormat('en').format({years:4294967296})}catch(e){return e.name}", "RangeError"],
  ["try{new Intl.DurationFormat('en').format({seconds:9007199254740992})}catch(e){return e.name}", "RangeError"],
  ["const value=()=>{};value.seconds=1;return new Intl.DurationFormat('en').format(value)", "1 sec"],
  ["try{new Intl.DurationFormat('en').format({})}catch(e){return e.name}", "TypeError"],
  ["try{new Intl.DurationFormat('en').format({hours:1,minutes:-1})}catch(e){return e.name}", "RangeError"]
])("supports DurationFormat: %s", async (source, expected) => {
  const result = await run(`if(typeof Intl.DurationFormat!=="function")throw new Error("Missing DurationFormat");${source}`);
  if (!result.ok) throw result.error;
  expect(result.returnValue).toEqual(expected);
});

it.each([
  ["return [Intl.DurationFormat.name,Intl.DurationFormat.length,Intl.DurationFormat.prototype.format.length,Object.keys(Intl.DurationFormat.prototype)]", ["DurationFormat", 0, 1, []]],
  ["class Child extends Intl.DurationFormat{};const f=new Child('en');return [f instanceof Child,f instanceof Intl.DurationFormat,f.format({seconds:1})]", [true, true, "1 sec"]],
  ["let reads=0;try{Intl.DurationFormat.prototype.format.call({},{get seconds(){reads++;return 1}})}catch(e){return [e.name,reads]}", ["TypeError", 0]],
  ["try{new Intl.DurationFormat.prototype.format({seconds:1})}catch(e){return e.name}", "TypeError"],
  ["const f=new Intl.DurationFormat('en');const r=f.resolvedOptions();r.locale='wrong';return [f.resolvedOptions().locale,r!==f.resolvedOptions(),Object.prototype.toString.call(f)]", ["en", true, "[object Intl.DurationFormat]"]],
  ["const trace=[];try{new Intl.DurationFormat('en',{get numberingSystem(){trace.push('numberingSystem');return 'a'},get style(){trace.push('style');return 'long'}})}catch(e){return [e.name,trace]}", ["RangeError", ["numberingSystem"]]]
])("preserves DurationFormat object semantics: %s", async (source, expected) => {
  expect(await run(source as string)).toMatchObject({ ok: true, returnValue: expected });
});

it("bounds duration output parts", async () => {
  await expect(run("return new Intl.DurationFormat('en',{style:'digital'}).formatToParts({hours:1,minutes:2,seconds:3})", {
    budget: new Budget({ arrayLength: 4 })
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
});

it.each([
  ["long", "1 hour, 2 minutes, "],
  ["short", "1 hr, 2 min, "],
  ["narrow", "1h 2m "]
])("keeps text minutes separate from numeric seconds in %s style", async (style, prefix) => {
  // FormatNumericUnits starts at seconds, so minutesFormatted is false. The
  // earlier text minute is a separate ListFormat element, not a clock field.
  for (const seconds of ["numeric", "2-digit"]) for (const secondsDisplay of ["auto", "always"]) {
    const options = { style, seconds, secondsDisplay };
    const expected = prefix + (seconds === "2-digit" ? "03" : "3") + ".456789123";
    expect(await run(`return new Intl.DurationFormat('en',${JSON.stringify(options)}).format({hours:1,minutes:2,seconds:3,milliseconds:456,microseconds:789,nanoseconds:123})`))
      .toMatchObject({ ok: true, returnValue: expected });
  }
});

it("bounds duration output strings", async () => {
  await expect(run("return new Intl.DurationFormat('en',{style:'long'}).format({years:1,months:2,weeks:3,days:4,hours:5,minutes:6,seconds:7})", {
    budget: new Budget({ stringLength: 40 })
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
});

it("rejects structured cloning before reading custom getters", async () => {
  expect(await run("let reads=0;const f=new Intl.DurationFormat('en');Object.defineProperty(f,'x',{enumerable:true,get(){reads++;return 1}});try{structuredClone(f)}catch(e){return [e.name,reads]}"))
    .toMatchObject({ ok: true, returnValue: ["DataCloneError", 0] });
});

it("accounts for private duration settings after prototype removal", async () => {
  const result = await run("return Object.setPrototypeOf(new Intl.DurationFormat('en'),null)");
  if (!result.ok) throw result.error;
  const state = durationFormatState(result.returnValue);
  expect(measureSandboxData([result.returnValue])).toBe(1 + measureSandboxData([state.settings, state.options]));
});

it("replays private duration state across a checkpoint", async () => {
  const source = "const f=new Intl.DurationFormat('fi',{style:'digital',fractionalDigits:2});f.self=f;await 0;return [f.self===f,f.format({seconds:-3,milliseconds:-123})]";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    const expected = { ok: true, returnValue: [true, "−0.00.03,12"] };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot })).toMatchObject(expected);
  } finally { await completed; }
});

it("restores duration state from a serialized closure heap", async () => {
  const source = "const f=new Intl.DurationFormat('en',{style:'digital'});f.self=f;return ()=>[f.self===f,f.format({hours:1,seconds:3})]";
  const result = await run(source);
  if (!result.ok) throw result.error;
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader: result.returnValue as RuntimeSnapshotValue } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restoreHeap(JSON.parse(JSON.stringify(saved)), { source });
  const binding = restored.currentScope.lookup("reader");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing reader");
  expect(await binding.value.call([])).toEqual([true, "1:00:03"]);
});

it.each(["separator", "locale", "fraction", "style", "calendar", "display", "unitExtra", "extra", "missing"])("rejects forged duration snapshot %s", async alteration => {
  const source = "return new Intl.DurationFormat('en',{style:'digital'})";
  const result = await run(source);
  if (!result.ok) throw result.error;
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { formatter: result.returnValue as RuntimeSnapshotValue } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const copy = JSON.parse(JSON.stringify(saved));
  const node = (Object.values(copy.heap) as Array<{ kind: string; settings: Record<string, unknown> & { units: Record<string, Record<string, unknown>> } }>).find(node => node.kind === "guest-durationformat");
  if (!node) throw new Error("Missing duration node");
  if (alteration === "separator") node.settings.separator = "wrong";
  if (alteration === "locale") node.settings.locale = "not-a-real-locale";
  if (alteration === "fraction") node.settings.fractionalDigits = 10;
  if (alteration === "style") node.settings.units.seconds!.style = "long";
  if (alteration === "calendar") node.settings.units.days!.style = "numeric";
  if (alteration === "display") node.settings.units.milliseconds!.display = "always";
  if (alteration === "unitExtra") node.settings.units.hours!.extra = 1;
  if (alteration === "extra") node.settings.extra = 1;
  if (alteration === "missing") delete node.settings.units.months;
  expect(() => restoreHeap(copy, { source })).toThrow();
});
