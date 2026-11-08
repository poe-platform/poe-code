import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { isSandboxClosure } from "../values.js";

const targets = [
  "function Target(){}",
  "const Target=(function(){}).bind(null);",
  "const Target=new Proxy(function(){},{});"
];

it.each(["WeakMap", "WeakSet"])("installs %s.prototype on the current Object prototype", async name => {
  expect(await run(`return Object.getPrototypeOf(${name}.prototype)===Object.prototype`))
    .toMatchObject({ ok: true, returnValue: true });
});

it.each(["WeakMap", "WeakSet"].flatMap(name => targets.flatMap(target =>
  ["undefined", "null", "7", "({custom:true})"].map(prototype => ({name,target,prototype})))))(
  "$name selects the newTarget realm: $target / $prototype", async ({name,target,prototype}) => {
    const source = `return [Reflect.construct,${name},Object.getPrototypeOf]`;
    const targetSource = `${target}Target.prototype=${prototype};return [Target,${name}.prototype,Target.prototype]`;
    const a = runInNewContext(`(()=>{${source}})()`);
    const b = runInNewContext(`(()=>{${targetSource}})()`);
    const expectedIndex = prototype === "({custom:true})" ? 2 : 1;
    expect(Object.getPrototypeOf(a[0](a[1],[],b[0]))).toBe(b[expectedIndex]);
    const exports = (await run(source)).returnValue;
    const targets = (await run(targetSource)).returnValue;
    if (!Array.isArray(exports) || !Array.isArray(targets) || !isSandboxClosure(exports[0]) || !isSandboxClosure(exports[2]))
      throw new Error("Expected constructor exports");
    const context = {stack:[],thisValue:undefined};
    const value = await exports[0].call([exports[1],[],targets[0]],context);
    expect(await exports[2].call([value],context)).toBe(targets[expectedIndex]);
  }
);

it.each(["WeakMap", "WeakSet"].flatMap(name => ["null", "({})"].map(prototype => ({name,prototype}))))(
  "$name checks revoked newTarget only when falling back from $prototype", async ({name,prototype}) => {
    const source = `const pair=Proxy.revocable(function(){},{get(){pair.revoke();return ${prototype}}});
      try{Reflect.construct(${name},[],pair.proxy);return 'ok'}catch(error){return error.name}`;
    const expected = runInNewContext(`(()=>{${source}})()`);
    expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
  }
);

it.each(["WeakMap", "WeakSet"])("preserves %s default realm after replay and global replacement", async name => {
  const source = `await 0;return [Reflect.construct,${name},Object.getPrototypeOf]`;
  const original = await run(source);
  const replayed = await run(source,{snapshot:JSON.parse(await dump(original))});
  const targetSource = `function Target(){}Target.prototype=null;const prototype=${name}.prototype;
    globalThis.${name}=undefined;await 0;return [Target,prototype]`;
  const target = await run(targetSource);
  const replayedTarget = await run(targetSource,{snapshot:JSON.parse(await dump(target))});
  for (const result of [original,replayed]) {
    const exports = result.returnValue;
    if (!Array.isArray(exports) || !isSandboxClosure(exports[0]) || !isSandboxClosure(exports[2]))
      throw new Error("Expected constructor exports");
    for (const candidate of [target,replayedTarget]) {
      const targets = candidate.returnValue;
      if (!Array.isArray(targets)) throw new Error("Expected target exports");
      const context = {stack:[],thisValue:undefined};
      const value = await exports[0].call([exports[1],[],targets[0]],context);
      expect(await exports[2].call([value],context)).toBe(targets[1]);
    }
  }
});
