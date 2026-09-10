import { describe, expect, it } from "vitest";

import { run } from "../../src/run.js";

describe("targeted Test262-style supported semantics", () => {
  it("imports registered modules without exposing an ambient loader", async () => {
    await expect(run("return (await import('fixture')).value",{modules:{fixture:{value:7}}}))
      .resolves.toMatchObject({ok:true,returnValue:7});
    await expect(run("try{await import('node:fs')}catch(error){return error.message.includes('Unknown module')}"))
      .resolves.toMatchObject({ok:true,returnValue:true});
  });
  it.each([
    [
      "keeps finally completion after catch",
      "try { throw 1; } catch (error) { return error; } finally { const observed = true; }",
      1
    ],
    [
      "uses short-circuit evaluation",
      "let calls = 0; function hit() { calls += 1; return true; } false && hit(); true || hit(); return calls;",
      0
    ],
    [
      "binds catch parameters lexically",
      "const error = 'outer'; try { throw 'inner'; } catch (error) { if (error !== 'inner') throw 'bad'; } return error;",
      "outer"
    ],
    [
      "supports class inheritance and super method dispatch",
      "class Base{value(){return 3}}class Child extends Base{value(){return super.value()+4}}return new Child().value()",
      7
    ],
    [
      "preserves private field values and brand checks",
      "class Box{#value=7;read(){return this.#value}has(value){return #value in value}}const box=new Box();return [box.read(),box.has(box),box.has({})]",
      [7, true, false]
    ],
    [
      "distinguishes array elisions from explicit undefined elements",
      "const values=[,undefined,,];return [values.length,0 in values,1 in values,2 in values]",
      [3, false, true, false]
    ]
  ])("%s", async (_name, source, expected) => {
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });
});

describe("Proxy and weak-reference semantics", () => {
  it("dispatches Proxy traps and rejects access after revocation", async () => {
    const source = `const events=[];const target={value:7};
      const revocable=Proxy.revocable(target,{get(t,key,receiver){events.push(key);return Reflect.get(t,key,receiver)}});
      const value=revocable.proxy.value;revocable.revoke();
      let error;try{revocable.proxy.value}catch(e){error=e.name}
      return [value,events,error];`;
    await expect(run(source)).resolves.toMatchObject({
      ok: true, returnValue: [7, ["value"], "TypeError"]
    });
  });

  it("supports live weak targets without depending on garbage-collection timing", async () => {
    const source = `const target={};const token={};const map=new WeakMap([[target,7]]);
      const set=new WeakSet([target]);const reference=new WeakRef(target);
      const registry=new FinalizationRegistry(()=>{throw 'unexpected cleanup'});
      registry.register(target,'held',token);
      return [map.get(target),set.has(target),reference.deref()===target,
        registry.unregister(token),registry.unregister(token),map.delete(target),set.delete(target)];`;
    await expect(run(source)).resolves.toMatchObject({
      ok: true, returnValue: [7, true, true, true, false, true, true]
    });
  });
});
