import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each(["Map","Set"])("exposes %s constructor metadata", async name => {
  expect((await run(`return [${name}.name,${name}.length]`)).returnValue).toEqual([name,0]);
});

it.each(["Map","Set"])("exposes the standard %s prototype descriptor", async name => {
  const source = `const descriptor=Object.getOwnPropertyDescriptor(${name},"prototype");
    return [typeof ${name}.prototype,descriptor.writable,descriptor.enumerable,descriptor.configurable]`;
  expect((await run(source)).returnValue).toEqual(["object",false,false,false]);
});

it.each(["Map","Set"])("links %s instances to their public prototype", async name => {
  const source = `const value=new ${name}();return [Object.getPrototypeOf(value)===${name}.prototype,
    ${name}.prototype.constructor===${name},Object.getPrototypeOf(${name}.prototype)===Object.prototype]`;
  expect((await run(source)).returnValue).toEqual([true,true,true]);
});

it.each([{name:"Map",method:"get"},{name:"Set",method:"add"}])(
  "shares %s prototype methods across instances", async ({name,method}) => {
    const source = `const a=new ${name}();const b=new ${name}();return [a.${method}===a.${method},
      a.${method}===b.${method},a.${method}===${name}.prototype.${method}]`;
    expect((await run(source)).returnValue).toEqual([true,true,true]);
  }
);

it("supports borrowed Map prototype methods", async () => {
  const source = 'const value=new Map();Map.prototype.set.call(value,"key",7);return [Map.prototype.get.call(value,"key"),Map.prototype.has.call(value,"key")]';
  expect((await run(source)).returnValue).toEqual([7,true]);
});

it("supports borrowed Set prototype methods", async () => {
  const source = 'const value=new Set();Set.prototype.add.call(value,7);return Set.prototype.has.call(value,7)';
  expect((await run(source)).returnValue).toBe(true);
});

it.each(["Map","Set"])("provides standard %s prototype descriptors and aliases", async name => {
  const source = `const prototype=${name}.prototype;const descriptor=Object.getOwnPropertyDescriptor(prototype,"size");
    return [Object.keys(prototype),descriptor.enumerable,descriptor.configurable,descriptor.set,
      descriptor.get.name,descriptor.get.length,${name}[Symbol.species]===${name},
      prototype[Symbol.iterator]===prototype.${name === "Map" ? "entries" : "values"},
      Object.prototype.toString.call(new ${name}())]`;
  expect((await run(source)).returnValue).toEqual([[],false,true,undefined,"get size",0,true,true,`[object ${name}]`]);
});

it("shares Set keys and values exactly", async () => {
  expect((await run('return [Set.prototype.keys===Set.prototype.values,Set.prototype.keys.name]')).returnValue)
    .toEqual([true,"values"]);
});

it.each([{name:"Map",method:"get",length:1},{name:"Map",method:"set",length:2},
  {name:"Set",method:"add",length:1},{name:"Set",method:"forEach",length:1}])(
  "exposes $name.prototype.$method metadata", async ({name,method,length}) => {
    const source = `const fn=${name}.prototype.${method};return [fn.name,fn.length,
      Object.getOwnPropertyDescriptor(${name}.prototype,"${method}"),Object.hasOwn(fn,"prototype")]`;
    const result = (await run(source)).returnValue as unknown[];
    expect(result[0]).toBe(method);
    expect(result[1]).toBe(length);
    expect(result[2]).toMatchObject({writable:true,enumerable:false,configurable:true});
    expect(result[3]).toBe(false);
  }
);

it.each(["Map","Set"])("rejects forged %s receivers for size and methods", async name => {
  const method = name === "Map" ? "get" : "add";
  const source = `const errors=[];const fake=Object.create(${name}.prototype);
    try{fake.${method}(1)}catch(error){errors.push(error.name)}
    try{Object.getOwnPropertyDescriptor(${name}.prototype,"size").get.call(fake)}catch(error){errors.push(error.name)}
    return errors`;
  expect((await run(source)).returnValue).toEqual(["TypeError","TypeError"]);
});

it.each(["Map","Set"])("honors %s prototype method replacement and deletion", async name => {
  const method = name === "Map" ? "get" : "has";
  const source = `const value=new ${name}();${name}.prototype.${method}=()=>7;
    const changed=value.${method}(1);delete ${name}.prototype.${method};return [changed,typeof value.${method}]`;
  expect((await run(source)).returnValue).toEqual([7,"undefined"]);
});

it.each(["Map","Set"].flatMap(name => ["pending","completed"].map(mode => ({name,mode}))))(
  "preserves $name prototype state in $mode checkpoints", async ({name,mode}) => {
    const method = name === "Map" ? "get" : "has";
    const source = `const value=new ${name}();const prototype=${name}.prototype;
      ${name}.extra=7;prototype.${method}=()=>9;
      const getter=Object.getOwnPropertyDescriptor(prototype,"size").get;
      Object.defineProperty(getter,"name",{value:"changed"});
      await 0;return [Object.getPrototypeOf(value)===prototype,value.${method}(1),value.size,
        ${name}.extra,getter.name,prototype.constructor===${name}]`;
    const pending = run(source);
    const completed = pending.catch(error => error);
    try {
      if (mode === "completed") await completed;
      const snapshot = restore(JSON.parse(await dump(pending)),{source});
      const result = await completed;
      expect(result).toMatchObject({ok:true,returnValue:[true,9,0,7,"changed",true]});
      expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:result.returnValue});
      expect(await run(source,{snapshot:result.snapshot})).toMatchObject({ok:true,returnValue:result.returnValue});
    } finally { await completed; }
  }
);

it("preserves callback receivers when using shared collection methods", async () => {
  const source = 'const seen=[];const receiver={tag:7};new Map([[1,2]]).forEach(function(value,key,map){seen.push([this.tag,key,value,map.size])},receiver);new Set([3]).forEach(function(value,key,set){seen.push([this.tag,key,value,set.size])},receiver);return seen';
  expect((await run(source)).returnValue).toEqual([[7,1,2,1],[7,3,3,1]]);
});

it.each(["Map","Set"])("observes %s iterator getters before using the intrinsic cursor", async name => {
  const source = `const calls=[];const original=${name}.prototype[Symbol.iterator];
    Object.defineProperty(${name}.prototype,Symbol.iterator,{get(){calls.push("get");return original}});
    const value=new ${name}(${name === "Map" ? '[[1,2]]' : '[1]'});return [[...value],calls]`;
  expect((await run(source)).returnValue).toEqual([name === "Map" ? [[1,2]] : [1],["get"]]);
});

it.each(["Map","Set"])("honors %s iterator replacement", async name => {
  const source = `${name}.prototype[Symbol.iterator]=function*(){yield 7;yield 8};return [...new ${name}()]`;
  expect((await run(source)).returnValue).toEqual([7,8]);
});

it.each(["Map","Set"])("tracks mutations to the %s size getter itself", async name => {
  const source = `const getter=Object.getOwnPropertyDescriptor(${name}.prototype,"size").get;
    Object.defineProperty(getter,"name",{value:"changed"});await 0;return getter.name`;
  const result = await run(source);
  expect(result.returnValue).toBe("changed");
  expect(() => restore({...result.snapshot},{source})).toThrow(expect.objectContaining({code:"invalidState"}));
  expect(await run(source,{snapshot:result.snapshot})).toMatchObject({ok:true,returnValue:"changed"});
});

it.each(["Map","Set"])("checks inherited %s properties without invoking getters", async name => {
  const source = `const calls=[];Object.defineProperty(${name}.prototype,"probe",{get(){calls.push("get");return undefined}});
    ${name}.prototype.empty=undefined;const value=new ${name}();const found=["probe" in value,"empty" in value];
    await 0;return [found,calls,"missing" in value]`;
  expect((await run(source)).returnValue).toEqual([[true,true],[],false]);
});
