import { describe, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

describe.each(["pending", "completed"] as const)("%s intrinsic mutation checkpoints", mode => {
it.each([
  ["BigInt.prototype.toJSON=function(){return String(this)}", "JSON.stringify(3n)", '"3"'],
  ["Number.prototype.label=function(){return 'number'}", "(3).label()", "number"],
  ["String.prototype.label=function(){return 'string'}", "'x'.label()", "string"],
  ["RegExp.prototype.label=function(){return this.source}", "(/abc/).label()", "abc"],
  ["Object.prototype.label=function(){return 'object'}", "({}).label()", "object"],
  ["BigInt.extra={value:3n}", "BigInt.extra.value", 3n],
  ["const alias=Number.prototype;alias.label=()=>3", "[alias===Number.prototype,(1).label()]", [true,3]],
  ["let calls=0;Object.defineProperty(Number.prototype,'label',{configurable:true,get(){calls++;return 3}})", "[(1).label,calls]", [3,1]]
])("preserves builtin mutation through replay: %s", async (mutation, expression, expected) => {
  const source=`${mutation};await 0;return ${expression};`;
  const pending=run(source);
  const completed=pending.catch(error=>error);
  try {
    if (mode === "completed") expect(await completed).toMatchObject({ok:true,returnValue:expected});
    const snapshot=restore(JSON.parse(await dump(pending)),{source});
    expect(await completed).toMatchObject({ok:true,returnValue:expected});
    expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:expected});
  } finally { await completed; }
});
});

it("allows ordinary own properties on builtin static functions before checkpointing", async () => {
  const source="try{Number.isNaN.extra=3;return Number.isNaN.extra}finally{delete Number.isNaN.extra}";
  const expected: unknown = Function('"use strict";'+source)();
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});
