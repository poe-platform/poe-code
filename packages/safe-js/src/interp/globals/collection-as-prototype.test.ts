import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each(["Map", "Set"])("inherits properties from a %s instance", async name => {
  const source = `const prototype = new ${name}(); prototype.answer = 42;
    const value = Object.create(prototype);
    return [value.answer, Object.getPrototypeOf(value) === prototype, value instanceof ${name}]`;
  expect((await run(source)).returnValue).toEqual([42, true, true]);
});

it.each(["Map", "Set"])("uses the child receiver for %s prototype accessors", async name => {
  const source = `const prototype = new ${name}();
    Object.defineProperty(prototype, "answer", {get(){return this.own},set(value){this.own=value},enumerable:true});
    const value = {}; Object.setPrototypeOf(value, prototype); value.answer=42;
    const keys=[]; for(const key in value) keys.push(key);
    return [value.answer,prototype.own,keys]`;
  expect((await run(source)).returnValue).toEqual([42, undefined, ["own", "answer"]]);
});

it.each(["Map", "Set"])("does not inherit %s storage slots", async name => {
  const source = `const prototype = new ${name}(); const value=Object.create(prototype);
    const errors=[];try { value.has(1); } catch(error) {errors.push(error instanceof TypeError)}
    try { value.size; } catch(error) {errors.push(error instanceof TypeError)}
    return errors`;
  expect((await run(source)).returnValue).toEqual([true, true]);
});

it.each(["Map", "Set"])("rejects cycles through %s prototypes", async name => {
  const source = `const prototype = new ${name}(); const value=Object.create(prototype);
    try {Object.setPrototypeOf(prototype,value);return false} catch(error){return error instanceof TypeError}`;
  expect((await run(source)).returnValue).toBe(true);
});

it.each(["Map", "Set"].flatMap(name => ["pending", "completed"].map(mode => ({name, mode}))))("restores a $name instance in a $mode prototype graph", async ({name, mode}) => {
  const source = `const prototype=new ${name}();prototype.answer=42;const value=Object.create(prototype);await 0;
    return [value.answer,Object.getPrototypeOf(value)===prototype,value instanceof ${name}]`;
  const pending=run(source);
  const completed=pending.catch(error=>error);
  try {
    if (mode === "completed") await completed;
    const snapshot=restore(JSON.parse(await dump(pending)),{source});
    expect(await completed).toMatchObject({ok:true,returnValue:[42,true,true]});
    expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:[42,true,true]});
  } finally {await completed;}
});

it.each(["Map", "Set"])("enumerates %s properties with shadowing and deletion", async name => {
  const source = `const prototype=new ${name}();prototype.a=1;prototype.b=2;prototype.c=3;
    const value=Object.create(prototype);Object.defineProperty(value,"b",{value:9,enumerable:false});
    const keys=[];for(const key in value){keys.push(key);delete prototype.c}
    return keys`;
  expect((await run(source)).returnValue).toEqual(["a"]);
});
