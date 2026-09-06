import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each(["Map", "Set"])("preserves %s subclass prototype identity", async name => {
  const source=`class Derived extends ${name} {} const value=new Derived();
    return [value instanceof Derived,Object.getPrototypeOf(value)===Derived.prototype,value instanceof ${name}]`;
  expect((await run(source)).returnValue).toEqual([true,true,true]);
});

it.each(["Map", "Set"])("exposes %s subclass methods", async name => {
  const source=`class Derived extends ${name} { label(){return "derived"} } const value=new Derived();return value.label()`;
  expect((await run(source)).returnValue).toBe("derived");
});

it.each(["Map","Set"])("uses the %s derived adder before initializing derived fields", async name => {
  const method=name === "Map" ? "set" : "add";
  const input=name === "Map" ? "[[1,2]]" : "[1]";
  const source=`const calls=[];class Derived extends ${name} {label="ready";${method}(...args){calls.push([this instanceof Derived,this.label]);return super.${method}(...args)}}
    const value=new Derived(${input});return [calls,value.label,value.size]`;
  expect((await run(source)).returnValue).toEqual([[[true,undefined]],"ready",1]);
});

it.each(["Map","Set"])("uses the %s prototype chain rather than the storage brand for instanceof", async name => {
  const source=`const value=new ${name}();Object.setPrototypeOf(value,null);return [value instanceof ${name},Object.getPrototypeOf(value)]`;
  expect((await run(source)).returnValue).toEqual([false,null]);
});

it.each(["Map","Set"].flatMap(name => ["pending","completed"].map(mode => ({name,mode}))))(
  "restores $name subclasses from $mode checkpoints", async ({name,mode}) => {
    const source=`class Derived extends ${name} {label(){return "derived"}} const value=new Derived();await 0;
      return [value instanceof Derived,Object.getPrototypeOf(value)===Derived.prototype,value.label()]`;
    const pending=run(source);
    const completed=pending.catch(error=>error);
    try {
      if(mode === "completed") await completed;
      const snapshot=restore(JSON.parse(await dump(pending)),{source});
      expect(await completed).toMatchObject({ok:true,returnValue:[true,true,"derived"]});
      expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:[true,true,"derived"]});
    } finally {await completed;}
  }
);
