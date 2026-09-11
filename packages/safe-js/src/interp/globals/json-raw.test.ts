import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { createRawJson, isRawJson } from "../raw-json.js";
import { captureGuestHeapNode } from "../../snapshot/guest-heap.js";
import { encodeReplayData, decodeReplayData } from "../../snapshot/replay-data.js";
import { deepCopyToSandbox } from "../values.js";
import { validateGuestHeapNode } from "../../snapshot/guest-heap-validation.js";
import { serialize } from "../../snapshot/serialize.js";
import { restore as restoreRuntime } from "../../snapshot/restore.js";
import { parseModule } from "../../parse/parser.js";

it.each(["1", "9007199254740993", "1e500", "-0", "true", "null", '"x"', '"\\ud800"'])(
  "supports raw JSON %s", async text => {
    const source = `const raw=JSON.rawJSON(${JSON.stringify(text)});return [JSON.stringify({raw}),raw.rawJSON,JSON.isRawJSON(raw),Object.isFrozen(raw),Object.getPrototypeOf(raw)===null]`;
    const expected = runInNewContext(`(()=>{${source}})()`);
    const result = await run(source);
    expect(result.ok).toBe(true);
    expect(result.returnValue).toEqual(expected);
  }
);

it("captures the raw JSON brand explicitly", () => {
  expect(captureGuestHeapNode(createRawJson("1e3"), value => value)).toEqual({kind:"raw-json",text:"1e3"});
});

it("preserves raw JSON identity and brand in replay data", () => {
  const raw = createRawJson("1e3");
  const restored = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData([raw,raw])))) as unknown[];
  expect(restored[0]).toBe(restored[1]);
  expect(isRawJson(restored[0])).toBe(true);
  expect(Object.isFrozen(restored[0])).toBe(true);
});

it("preserves the brand when copying trusted raw values into a sandbox", () => {
  expect(isRawJson(deepCopyToSandbox(createRawJson("1e3")))).toBe(true);
});

it("restores raw JSON from a runtime heap without reexecuting its creation", () => {
  const source = "return 0";
  const value = createRawJson("1e3");
  const snapshot = serialize({ source, currentAstNodeId: parseModule(source).body[0]!.nodeId!,
    scopeChain: [{id:"module",bindings:{value,alias:value}}],callStack:[],pendingPromises:[],moduleBindings:{} });
  const restored = restoreRuntime(JSON.parse(JSON.stringify(snapshot)), {source});
  const bindings = restored.scopeChain[0]!.bindings;
  expect(isRawJson(bindings.value)).toBe(true);
  expect(bindings.value).toBe(bindings.alias);
});

it.each([
  {kind:"raw-json",text:"{}"}, {kind:"raw-json",text:" 1"},
  {kind:"raw-json",text:1}, {kind:"raw-json"},
  {kind:"raw-json",text:"1",extra:true}, {kind:"raw-json",text:'1,"injected":2'}
])("rejects malformed raw JSON records: %j", node => {
  expect(()=>validateGuestHeapNode(node,{})).toThrow();
  expect(()=>decodeReplayData({root:{tag:"ref",id:0},nodes:[node]})).toThrow();
});

it.each(["", " 1", "1 ", "{}", "[]", "undefined", "NaN", "01", "1,2"])("rejects invalid raw JSON %s", async text => {
  expect((await run(`try{JSON.rawJSON(${JSON.stringify(text)});return false}catch(error){return error instanceof SyntaxError}`)).returnValue).toBe(true);
});

it.each([
  'const value=JSON.rawJSON("1");return [JSON.isRawJSON(value),JSON.isRawJSON({...value}),JSON.isRawJSON(Object.create(value)),JSON.isRawJSON(null),JSON.isRawJSON(1)]',
  'const value=JSON.rawJSON("1");return Object.getOwnPropertyDescriptor(value,"rawJSON")',
  'return JSON.stringify([1,2],(key,value)=>typeof value==="number"?JSON.rawJSON("1e3"):value)',
  'return JSON.stringify({toJSON(){return JSON.rawJSON("9007199254740993")}})',
  'return JSON.rawJSON({[Symbol.toPrimitive](hint){return hint==="string"?"true":"false"}}).rawJSON',
  'try{JSON.rawJSON(Symbol())}catch(error){return error.name}',
  'const value=JSON.rawJSON("1");let rejected=false;try{value.rawJSON="2"}catch(error){rejected=true}return [rejected,value.rawJSON]',
  'return [JSON.rawJSON.length,JSON.isRawJSON.length]'
])("matches native raw JSON: %s", async source => {
  const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
  const result = await run(source);
  expect(result.ok).toBe(true);
  expect(result.returnValue).toEqual(expected);
});

it.each(["pending", "completed"])("preserves raw JSON in %s checkpoints", async mode => {
  const source = 'const raw=JSON.rawJSON("1e3");const alias=raw;await 0;return [raw===alias,JSON.isRawJSON(raw),JSON.stringify(raw),Object.isFrozen(raw),Object.getPrototypeOf(raw)===null]';
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ok:true,returnValue:[true,true,"1e3",true,true]});
    expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:[true,true,"1e3",true,true]});
  } finally { await completed; }
});
