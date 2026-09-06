import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { deepCopyFromSandbox } from "../values.js";

it.each(["Map", "Set"])("supports own data properties on %s instances", async name => {
  const source = `const value=new ${name}();value.label=7;return [value.label,Object.keys(value),Object.hasOwn(value,"label")]`;
  expect((await run(source)).returnValue).toEqual([7,["label"],true]);
});

it.each(["Map", "Set"])("supports own accessors on %s instances", async name => {
  const source = `const value=new ${name}();let stored=1;Object.defineProperty(value,"label",{get(){return stored},set(next){stored=next},enumerable:true});
    value.label=7;return [value.label,Object.keys(value)]`;
  expect((await run(source)).returnValue).toEqual([7,["label"]]);
});

it.each(["Map", "Set"])("keeps own names separate from internal %s storage", async name => {
  const source = `const value=new ${name}();value.kind="guest";value.entries=7;value.values=8;
    return [value.kind,value.entries,value.values,value.size]`;
  expect((await run(source)).returnValue).toEqual(["guest",7,8,0]);
});

it.each(["Map", "Set"])("preserves %s own data properties in returned values", async name => {
  const source=`const value=new ${name}();value.label=7;value.self=value;return value`;
  const value=deepCopyFromSandbox((await run(source)).returnValue) as {label:number;self:unknown};
  expect(value.label).toBe(7);
  expect(value.self).toBe(value);
});

it.each(["Map", "Set"])("supports %s symbol properties, spread and deletion", async name => {
  const source=`const value=new ${name}();const key=Symbol("label");value[key]=7;value.label=8;
    const spread={...value};const symbols=Object.getOwnPropertySymbols(value);delete value.label;
    return [spread[key],spread.label,symbols[0]===key,Object.keys(value),"label" in value]`;
  expect((await run(source)).returnValue).toEqual([7,8,true,[],false]);
});

it.each(["Map", "Set"])("freezes %s own properties without freezing collection contents", async name => {
  const source=`const value=new ${name}();value.label=7;Object.freeze(value);let error;
    try{value.label=8}catch(caught){error=caught.name}
    value.${name === "Map" ? "set(1,2)" : "add(1)"};
    return [value.label,Object.isFrozen(value),value.size,error]`;
  expect((await run(source)).returnValue).toEqual([7,true,1,"TypeError"]);
});

it.each(["Map", "Set"])("uses %s own coercion methods", async name => {
  const source=`const value=new ${name}();value.toString=()=>"custom";return String(value)`;
  expect((await run(source)).returnValue).toBe("custom");
});

it.each(["Map", "Set"])("serializes %s own enumerable properties as JSON", async name => {
  const source=`const value=new ${name}();value.label=7;return JSON.stringify(value)`;
  expect((await run(source)).returnValue).toBe('{"label":7}');
});

it.each(["Map", "Set"])("structuredClone ignores %s custom properties without invoking accessors", async name => {
  const source=`const value=new ${name}(${name === "Map" ? "[[1,2]]" : "[1]"});
    Object.defineProperty(value,"label",{get(){throw new Error("must not read")},enumerable:true});
    const copy=structuredClone(value);return [copy.size,Object.keys(copy)]`;
  expect((await run(source)).returnValue).toEqual([1,[]]);
});

it.each(["Map", "Set"].flatMap(name => ["pending", "completed"].map(mode => ({name,mode}))))(
  "restores $name own descriptors in $mode checkpoints", async ({name,mode}) => {
    const source=`const value=new ${name}();let stored=7;
      Object.defineProperty(value,"label",{get(){return stored},set(next){stored=next},enumerable:true});
      Object.defineProperty(value,"hidden",{value:9});value.self=value;await 0;
      value.label=8;return [value.label,value.hidden,value.self===value,Object.keys(value)]`;
    const pending=run(source);
    const completed=pending.catch(error=>error);
    try {
      if(mode==="completed") await completed;
      const snapshot=restore(JSON.parse(await dump(pending)),{source});
      expect(await completed).toMatchObject({ok:true,returnValue:[8,9,true,["label","self"]]});
      expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:[8,9,true,["label","self"]]});
    } finally {await completed;}
  }
);
