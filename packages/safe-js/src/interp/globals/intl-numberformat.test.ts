import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { serialize, type RuntimeSnapshotValue } from "../../snapshot/serialize.js";
import { restore as restoreHeap } from "../../snapshot/restore.js";
import { isSandboxClosure, measureSandboxData } from "../values.js";
import { Budget } from "../budget.js";

it.each([
  "return [typeof Intl.NumberFormat,Intl.NumberFormat.name,Intl.NumberFormat.length]",
  "return new Intl.NumberFormat('en',{style:'currency',currency:'USD'}).resolvedOptions()",
  "const value=Intl.NumberFormat('de');return [value instanceof Intl.NumberFormat,value.format(1234.5)]",
  "class Child extends Intl.NumberFormat{};const value=new Child('en');return [value instanceof Child,value instanceof Intl.NumberFormat,value.format(12)]",
  "const value=new Intl.NumberFormat('en');return [value.format===value.format,value.format.name,value.format.length,Object.getOwnPropertyNames(value.format),String(value.format)]",
  "const value=new Intl.NumberFormat('en');return value.format.call(null,1234)",
  "const value=new Intl.NumberFormat('en');return value.formatToParts(1234.5)",
  "const value=new Intl.NumberFormat('de',{style:'currency',currency:'EUR'});return value.formatRange(1,5)",
  "const value=new Intl.NumberFormat('en');return value.formatRangeToParts(1,5)",
  "return new Intl.NumberFormat('en',{useGrouping:false}).format('123456789012345678901234567890')",
  "return new Intl.NumberFormat('en').format(12345678901234567890n)",
  "const value=new Intl.NumberFormat('en');return [NaN,Infinity,-Infinity,-0].map(value.format)",
  "const value=new Intl.NumberFormat('en');const options=value.resolvedOptions();options.locale='wrong';return [options!==value.resolvedOptions(),value.resolvedOptions().locale]",
  "return Intl.NumberFormat.supportedLocalesOf(['EN-us','fr','en-US'],{localeMatcher:'lookup'})",
  "const trace=[];Intl.NumberFormat.supportedLocalesOf('en',{get localeMatcher(){trace.push('matcher');return 'lookup'},get style(){throw 7}});return trace",
  "const value=new Intl.NumberFormat('en');Object.freeze(value);return [Object.isFrozen(value),value.format(1),Object.prototype.toString.call(value)]",
  "const descriptor=Object.getOwnPropertyDescriptor(Intl.NumberFormat,'prototype');return [descriptor.writable,descriptor.enumerable,descriptor.configurable]",
  "const descriptor=Object.getOwnPropertyDescriptor(Intl.NumberFormat.prototype,'format');return [descriptor.get.name,descriptor.get.length,descriptor.enumerable,descriptor.configurable]",
  "try{Intl.NumberFormat.prototype.formatToParts.call({},{valueOf(){throw 7}})}catch(error){return error.name}",
  "try{new Intl.NumberFormat('en',null)}catch(error){return error.name}",
  "try{const format=new Intl.NumberFormat('en').format;new format(1)}catch(error){return error.name}",
  "const trace=[];try{new Intl.NumberFormat('en').formatRange(Symbol(),{valueOf(){trace.push('second');return 2}})}catch(error){return [error.name,trace]}",
  "const trace=[];try{new Intl.NumberFormat('en').formatRange(NaN,{valueOf(){trace.push('second');return 2}})}catch(error){return [error.name,trace]}",
  "const locale=new Intl.Locale('de');locale.toString=()=>{throw 7};return new Intl.NumberFormat(locale).resolvedOptions().locale"
])("matches current native NumberFormat behavior: %s", async source => {
  const expected = runInNewContext(`(function(){'use strict';${source}})()`);
  const result = await run(source);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  expect(result.returnValue).toEqual(expected);
});

it("selects the derived prototype before locale or option coercion", async () => {
  const source = "const trace=[];const proto={};const Child=(function(){}).bind(null);Object.defineProperty(Child,'prototype',{get(){trace.push('prototype');return proto}});const value=Reflect.construct(Intl.NumberFormat,[{get length(){trace.push('locales');return 0}},{get style(){trace.push('style');return 'decimal'}}],Child);return [Object.getPrototypeOf(value)===proto,trace]";
  expect(await run(source)).toMatchObject({ ok: true, returnValue: [true, ["prototype", "locales", "style"]] });
});

it("meters private resolved options after the guest prototype is removed", async () => {
  const result = await run("return Object.setPrototypeOf(new Intl.NumberFormat('en'),null)");
  if (!result.ok) throw result.error;
  expect(measureSandboxData([result.returnValue])).toBe(1 + measureSandboxData([new Intl.NumberFormat("en").resolvedOptions()]));
});

it("bounds the output parts array", async () => {
  await expect(run("return new Intl.NumberFormat('en').formatToParts(1234.5)", { budget: new Budget({ arrayLength: 3 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
});

it("charges exact decimal input work before formatting", async () => {
  await expect(run("export default value=>new Intl.NumberFormat('en').format(value)", {
    entryPointArgs: ["1".repeat(2000)], budget: new Budget({ maxSteps: 1000 })
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
});

it("bounds formatted BigInt output strings", async () => {
  await expect(run("export default value=>new Intl.NumberFormat('en').format(value)", {
    entryPointArgs: [BigInt("1".repeat(100))], budget: new Budget({ stringLength: 16 })
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
});

it.each(["missing-option", "wrong-option-type", "extra-option", "foreign-format"])("rejects forged formatter state: %s", async alteration => {
    const source = "const a=new Intl.NumberFormat('en');const b=new Intl.NumberFormat('fr');return [a,b,a.format,b.format]";
    const result = await run(source);
    if (!result.ok) throw result.error;
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { values: result.returnValue as RuntimeSnapshotValue } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const copied = JSON.parse(JSON.stringify(saved));
    const nodes = (Object.values(copied.heap) as Array<{kind: string; options: Record<string, unknown>; format?: unknown}>).filter(node => node.kind === "guest-numberformat");
    expect(nodes).toHaveLength(2);
    if (alteration === "missing-option") delete nodes[0].options.style;
    else if (alteration === "wrong-option-type") nodes[0].options.minimumIntegerDigits = "1";
    else if (alteration === "extra-option") nodes[0].options.unknown = true;
    else nodes[0].format = nodes[1].format;
    expect(() => restoreHeap(copied, { source })).toThrow();
});

it.each([
  ["floor", "1", "-2"], ["ceil", "2", "-1"], ["trunc", "1", "-1"],
  ["expand", "2", "-2"], ["halfEven", "2", "-2"]
])("implements %s rounding on every supported Node runtime", async (roundingMode, positive, negative) => {
  expect(await run(`const value=new Intl.NumberFormat('en',{maximumFractionDigits:0,roundingMode:'${roundingMode}'});return [value.format(1.9),value.format(-1.9)]`))
    .toMatchObject({ ok: true, returnValue: [positive, negative] });
});

it("returns only standard range-part properties and marks collapsed currency as shared", async () => {
  const source = "const parts=new Intl.NumberFormat('de',{style:'currency',currency:'EUR'}).formatRangeToParts(1,5);return [parts.every(part=>Object.keys(part).join(',')==='type,value,source'),parts.filter(part=>part.type==='currency').map(part=>part.source)]";
  expect(await run(source)).toMatchObject({ ok: true, returnValue: [true, ["shared"]] });
});

it("places the English approximation sign before equal rounded range values", async () => {
  const source = "const value=new Intl.NumberFormat('en',{maximumFractionDigits:0});return [value.formatRange(1.1,1.2),value.formatRangeToParts(1.1,1.2)]";
  expect(await run(source)).toMatchObject({ ok: true, returnValue: ["~1", [
    { type: "approximatelySign", value: "~", source: "shared" },
    { type: "integer", value: "1", source: "shared" }
  ]] });
});

it("replays formatter and bound format aliases", async () => {
  const source = "const value=new Intl.NumberFormat('en',{maximumFractionDigits:0,roundingMode:'floor'});const format=value.format;format.owner=value;await 0;return [value.format===format,format.owner===value,format(1.9)]";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    const expected = { ok: true, returnValue: [true, true, "1"] };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot })).toMatchObject(expected);
  } finally { await completed; }
});

it("restores private formatter state and cached format through repeated heap snapshots", async () => {
  const source = "const value=new Intl.NumberFormat('en',{maximumFractionDigits:0,roundingMode:'floor'});const format=value.format;format.owner=value;value.extra=1;return ()=>[format===value.format,format.owner===value,format(1.9),value.extra++]";
  const result = await run(source);
  if (!result.ok) throw result.error;
  let reader = result.returnValue as RuntimeSnapshotValue;
  for (let count = 1; count <= 2; count++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restoreHeap(JSON.parse(JSON.stringify(saved)), { source });
    const binding = restored.currentScope.lookup("reader");
    if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing reader");
    expect(await binding.value.call([])).toEqual([true, true, "1", count]);
    reader = binding.value;
  }
});
