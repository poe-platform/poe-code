import { expect, it } from "vitest";
import { run } from "../../run.js";

it("accepts the well-known disposal symbols despite their host registry representation", async () => {
  expect(await run(`return [new WeakRef(Symbol.dispose).deref()===Symbol.dispose,
    new WeakRef(Symbol.asyncDispose).deref()===Symbol.asyncDispose]`))
    .toMatchObject({ok:true,returnValue:[true,true]});
});

it("retains a WeakRef target through repeated dereferences in one guest job", async () => {
  expect(await run(`let target={value:7}; const reference=new WeakRef(target);
    const same=reference.deref()===target; target=null;
    return [same,reference.deref().value,reference.deref()===reference.deref(),
      Object.prototype.toString.call(reference)]`))
    .toMatchObject({ok:true,returnValue:[true,7,true,"[object WeakRef]"]});
});

it("requires construction and rejects incompatible deref receivers", async () => {
  expect(await run(`const rejected=[];
    for(const action of [()=>WeakRef({}),()=>new WeakRef(null),()=>new WeakRef(1),
      ()=>WeakRef.prototype.deref(),()=>WeakRef.prototype.deref.call({}),
      ()=>WeakRef.prototype.deref.call(new Proxy(new WeakRef({}),{}))]){
      try{action();rejected.push(false)}catch(error){rejected.push(error instanceof TypeError)}
    }return rejected`)).toMatchObject({ok:true,returnValue:[true,true,true,true,true,true]});
});

it("supports subclasses and validates targets before reading newTarget.prototype", async () => {
  expect(await run(`class Derived extends WeakRef{};const target={};const reference=new Derived(target);
    let reads=0;const alternative=new Proxy(function(){},{get(t,key){if(key==='prototype')reads++;return Reflect.get(t,key)}});
    try{Reflect.construct(WeakRef,[1],alternative)}catch{}
    return [reference instanceof Derived,reference instanceof WeakRef,reference.deref()===target,reads,
      WeakRef.length,WeakRef.prototype.deref.length]`))
    .toMatchObject({ok:true,returnValue:[true,true,true,0,1,0]});
});

it("rejects WeakRef structured cloning", async () => {
  expect(await run(`try{structuredClone(new WeakRef({}));return 'accepted'}catch(error){return error.name}`))
    .toMatchObject({ok:true,returnValue:"DataCloneError"});
});

it("accepts non-registered symbols and rejects registered symbols", async () => {
  expect(await run(`const unique=Symbol('target');const wellKnown=Symbol.iterator;
    let rejected=false;try{new WeakRef(Symbol.for('registered'))}catch(error){rejected=error instanceof TypeError}
    return [new WeakRef(unique).deref()===unique,new WeakRef(wellKnown).deref()===wellKnown,rejected]`))
    .toMatchObject({ok:true,returnValue:[true,true,true]});
});
