import { expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";

it("charges strong held values even when the target is only weakly retained", async () => {
  await expect(run(`const registry=new FinalizationRegistry(()=>{});
    for(let index=0;index<32;index++)registry.register({},'abcdefgh'.repeat(64));
    return 'done'`, {budget:new Budget({dataSize:4096})}))
    .rejects.toMatchObject({code:"budgetExceeded",budget:"dataSize"});
});

it("rejects structured cloning of a registry", async () => {
  expect(await run(`const registry=new FinalizationRegistry(()=>{});
    try{structuredClone(registry);return 'accepted'}catch(error){return error.name}`))
    .toMatchObject({ok:true,returnValue:"DataCloneError"});
});

it("registers multiple cells and unregisters every matching token", async () => {
  expect(await run(`const calls=[];const registry=new FinalizationRegistry(value=>calls.push(value));
    const target={},token={},other={};
    const result=registry.register(target,'first',token);
    registry.register(target,'second',token);registry.register(target,'third',other);
    return [result===undefined,registry.unregister(token),registry.unregister(token),
      registry.unregister(other),calls.length,Object.prototype.toString.call(registry)]`))
    .toMatchObject({ok:true,returnValue:[true,true,false,true,0,"[object FinalizationRegistry]"]});
});

it("validates constructor, receiver, target, held value and unregister token", async () => {
  expect(await run(`const registry=new FinalizationRegistry(()=>{}),target={};const rejected=[];
    for(const action of [()=>FinalizationRegistry(()=>{}),()=>new FinalizationRegistry(1),
      ()=>FinalizationRegistry.prototype.register(target,1),
      ()=>registry.register(null,1),()=>registry.register(target,target),
      ()=>registry.register(target,1,null),()=>registry.unregister(undefined),
      ()=>registry.register(Symbol.for('registered'),1),
      ()=>registry.register(target,1,Symbol.for('registered'))]){
      try{action();rejected.push(false)}catch(error){rejected.push(error instanceof TypeError)}
    }return rejected`))
    .toMatchObject({ok:true,returnValue:[true,true,true,true,true,true,true,true,true]});
});

it("supports unique and well-known symbols as targets and unregister tokens", async () => {
  expect(await run(`const registry=new FinalizationRegistry(()=>{}),token=Symbol('token');
    registry.register(Symbol('target'),'unique',token);
    registry.register(Symbol.iterator,'iterator',Symbol.dispose);
    registry.register(Symbol.dispose,'dispose',Symbol.asyncDispose);
    return [registry.unregister(token),registry.unregister(Symbol.dispose),registry.unregister(Symbol.asyncDispose)]`))
    .toMatchObject({ok:true,returnValue:[true,true,true]});
});

it("supports subclasses and validates callbacks before newTarget.prototype lookup", async () => {
  expect(await run(`class Derived extends FinalizationRegistry{};const registry=new Derived(()=>{});
    let reads=0;const target=new Proxy(function(){},{get(t,key){if(key==='prototype')reads++;return Reflect.get(t,key)}});
    try{Reflect.construct(FinalizationRegistry,[1],target)}catch{}
    return [registry instanceof Derived,registry instanceof FinalizationRegistry,reads,
      FinalizationRegistry.length,FinalizationRegistry.prototype.register.length,
      FinalizationRegistry.prototype.unregister.length]`))
    .toMatchObject({ok:true,returnValue:[true,true,0,1,2,1]});
});
