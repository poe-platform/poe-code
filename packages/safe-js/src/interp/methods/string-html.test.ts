import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { Budget, run } from "../../core.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

const names = ["anchor", "big", "blink", "bold", "fixed", "fontcolor", "fontsize", "italics", "link", "small", "strike", "sub", "sup"];

it.each(names)("matches native String.prototype.%s output and metadata", async name => {
  const source = `const f=String.prototype[${JSON.stringify(name)}];const d=Object.getOwnPropertyDescriptor(String.prototype,${JSON.stringify(name)});return [f.call(${JSON.stringify("<&\ud800😀")}, ${JSON.stringify('"<&\'\u0000')}),f.call(7),f.call(true,null),f.name,f.length,d.writable,d.enumerable,d.configurable]`;
  expect(await run(source)).toMatchObject({ok: true, returnValue: runInNewContext(`(function(){${source}})()`)});
});

it.each([
  "const seen=[];const text={toString(){seen.push('receiver');return 'body'}};const attr={toString(){seen.push('attribute');return '\"'}};return [String.prototype.anchor.call(text,attr),seen]",
  "const seen=[];const attr={toString(){seen.push('wrong');throw 1}};return ['body'.bold(attr),seen]",
  "const seen=[];try{String.prototype.link.call(null,{toString(){seen.push('wrong');return ''}})}catch(e){return [e.name,seen]}",
  "const seen=[];try{String.prototype.link.call({toString(){throw 7}},{toString(){seen.push('wrong');return ''}})}catch(e){return [e,seen]}",
  "try{return 'x'.link(Symbol())}catch(e){return e.name}",
  "try{return String.prototype.bold.call(Symbol())}catch(e){return e.name}",
  "const f=()=>{};f.toString=()=> 'guest';return 'x'.anchor(f)",
  "const x={[Symbol.toPrimitive](hint){return hint}};return String.prototype.fontsize.call(x,x)",
  "const x={toString(){return {}},valueOf(){return 9}};return 'x'.fontcolor(x)",
  "return 'x'.link({async toString(){return 'wrong'},valueOf(){return 'fallback'}})",
  "try{new String.prototype.bold()}catch(e){return e.name}",
  "const f=String.prototype.link;f.marker={value:7};return [f===String.prototype.link,f.marker.value,'x'.link('y')]"
])("preserves CreateHTML conversion semantics: %s", async source => {
  expect(await run(source)).toMatchObject({ok: true, returnValue: runInNewContext(`(function(){'use strict';${source}})()`)});
});

it("enforces the length of the escaped output", async () => {
  await expect(run("return 'x'.anchor('\"'.repeat(20))", {budget: new Budget({stringLength: 100})}))
    .rejects.toMatchObject({code: "budgetExceeded", budget: "stringLength"});
});

it("retains converted receiver text across attribute coercion", async () => {
  const source = "function first(){return 'b'.repeat(2000)}function allocate(){const temporary='y'.repeat(5000);throw 'allocated'}try{return String.prototype.link.call({toString:first},{toString:allocate})}catch(e){return e}";
  const budget = new Budget({dataSize: 6000});
  await expect(run(source, {budget})).rejects.toMatchObject({code: "budgetExceeded", budget: "dataSize"});
  expect([...budget.retainedValues()]).toEqual([]);
  expect(await run(source, {budget: new Budget({dataSize: 14000})})).toMatchObject({ok: true, returnValue: "allocated"});
});

it("preserves fatal step exhaustion in attribute conversion", async () => {
  await expect(run("try{return 'x'.link({toString(){while(true){}return ''}})}catch(e){return 'caught'}", {budget: new Budget({maxSteps: 100})}))
    .rejects.toMatchObject({code: "budgetExceeded", budget: "steps"});
});

it("replays a checkpoint inside attribute conversion", async () => {
  const source = "function* g(){yield '\"';return 'next'}const gen=g();const attr={toString(){return gen.next().value}};return ['x'.link(attr),'y'.anchor(attr)]";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const saved = JSON.parse(await dump(pending));
    const expected = runInNewContext(`(function(){${source}})()`);
    expect(await completed).toMatchObject({ok: true, returnValue: expected});
    expect(await run(source, {snapshot: restore(saved, {source})})).toMatchObject({ok: true, returnValue: expected});
  } finally { await completed; }
});
