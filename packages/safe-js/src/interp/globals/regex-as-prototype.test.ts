import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it("inherits and enumerates properties from a regex instance", async () => {
  const source=`const prototype=/x/;prototype.answer=42;const value=Object.create(prototype);
    const keys=[];for(const key in value)keys.push(key);
    return [value.answer,Object.getPrototypeOf(value)===prototype,keys]`;
  expect((await run(source)).returnValue).toEqual([42,true,["answer"]]);
});

it("keeps inherited regex accessors bound to the child", async () => {
  const source=`const prototype=/x/;Object.defineProperty(prototype,"answer",{get(){return this.own},set(value){this.own=value}});
    const value={};Object.setPrototypeOf(value,prototype);value.answer=42;return [value.answer,prototype.own]`;
  expect((await run(source)).returnValue).toEqual([42,undefined]);
});

it("does not inherit regex internal slots", async () => {
  const source=`const value=Object.create(/x/);try {value.exec("x");return false}catch(error){return error instanceof TypeError}`;
  expect((await run(source)).returnValue).toBe(true);
});

it("rejects prototype cycles through regex instances", async () => {
  const source=`const prototype=/x/;const value=Object.create(prototype);
    try {Object.setPrototypeOf(prototype,value);return false}catch(error){return error instanceof TypeError}`;
  expect((await run(source)).returnValue).toBe(true);
});

it("honors shadowing and live deletion of inherited regex properties", async () => {
  const source=`const prototype=/x/;prototype.a=1;prototype.b=2;prototype.c=3;
    const value=Object.create(prototype);Object.defineProperty(value,"b",{value:9});
    const keys=[];for(const key in value){keys.push(key);delete prototype.c}return keys`;
  expect((await run(source)).returnValue).toEqual(["a"]);
});

it.each(["pending","completed"])("restores regex prototype graphs from %s checkpoints", async mode => {
  const source=`const prototype=/x/g;prototype.answer=42;const value=Object.create(prototype);await 0;
    return [value.answer,Object.getPrototypeOf(value)===prototype,prototype.exec("x")[0]]`;
  const pending=run(source);
  const completed=pending.catch(error=>error);
  try {
    if(mode === "completed") await completed;
    const snapshot=restore(JSON.parse(await dump(pending)),{source});
    expect(await completed).toMatchObject({ok:true,returnValue:[42,true,"x"]});
    expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:[42,true,"x"]});
  } finally {await completed;}
});
