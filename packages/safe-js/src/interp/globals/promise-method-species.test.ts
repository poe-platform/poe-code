import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";

it.each(["then", "finally"])("Promise.%s validates Symbol.species", async method => {
  const result = await run(`
    const value=Promise.resolve(1);value.constructor={[Symbol.species]:42};
    try{value.${method}(()=>0);return false}catch(error){return error instanceof TypeError}
  `);
  expect(result.returnValue === true).toBe(true);
});

const cases = [
  {
    name: "nullish species falls back to Promise",
    source: `for(const species of [null,undefined]){
      const value=Promise.resolve(1);value.constructor={[Symbol.species]:species};
      if((await value.then(x=>x+1))!==2 || (await value.finally(()=>0))!==1)return false;
    }return true`
  },
  {
    name: "callable nonconstructible species is rejected",
    source: `const value=Promise.resolve(1);value.constructor={[Symbol.species]:()=>{}};
      try{value.then();return false}catch(error){return error instanceof TypeError}`
  },
  {
    name: "species getter has the constructor receiver and runs once",
    source: `const events=[], value=Promise.resolve(1), constructor={};
      Object.defineProperty(constructor,Symbol.species,{get(){
        if(this!==constructor)throw new Error("receiver");events.push("species");return Promise;
      }});value.constructor=constructor;
      const pending=value.then(x=>x);events.push("after");
      return (await pending)===1 && events.join(",")==="species,after"`
  },
  {
    name: "species constructor errors propagate synchronously",
    source: `const marker={}, value=Promise.resolve(1);
      value.constructor={[Symbol.species]:function(){throw marker}};
      try{value.then();return false}catch(error){return error===marker}`
  },
  {
    name: "invalid species capability is rejected synchronously",
    source: `const value=Promise.resolve(1);
      value.constructor={[Symbol.species]:function(executor){executor(1,2)}};
      try{value.then();return false}catch(error){return error instanceof TypeError}`
  },
  {
    name: "missing handlers preserve raw fulfillment values for custom resolvers",
    source: `const box={}, value=Promise.resolve(42);
      value.constructor={[Symbol.species]:function(executor){executor(x=>{box.value=x},e=>{box.error=e});return box}};
      const result=value.then();await result;return result===box && box.value===42`
  },
  {
    name: "missing handlers forward rejection to custom reject",
    source: `const box={}, marker={}, value=Promise.reject(marker);
      value.constructor={[Symbol.species]:function(executor){executor(x=>{box.value=x},e=>{box.error=e});return box}};
      const result=value.then();await result;return result===box && box.error===marker`
  },
  {
    name: "species getter errors precede finally then lookup",
    source: `const marker={}, events=[], value=Promise.resolve(1);
      value.constructor={get [Symbol.species](){events.push("species");throw marker}};
      Object.defineProperty(value,"then",{get(){events.push("then");return ()=>0}});
      try{value.finally(0);return false}catch(error){return error===marker && events.join(",")==="species"}`
  },
  {
    name: "then constructs its selected species before returning",
    source: `let calls=0, created;
      function Custom(executor){calls++;created=new Promise(executor);return created}
      const value=Promise.resolve(1);value.constructor={[Symbol.species]:Custom};
      const result=value.then(x=>x+1);
      const immediate=result===created && calls===1;
      return immediate && (await result)===2`
  },
  {
    name: "custom species receives raw handler results without premature assimilation",
    source: `const box={};
      function Custom(executor){executor(value=>{box.value=value},reason=>{box.error=reason});return box}
      const value=Promise.resolve(1), thenable={then(resolve){resolve(99)}};
      value.constructor={[Symbol.species]:Custom};
      const result=value.then(()=>thenable);await result;
      return result===box && box.value===thenable`
  },
  {
    name: "custom species receives thrown handler errors",
    source: `const box={}, marker={};
      function Custom(executor){executor(value=>{box.value=value},reason=>{box.error=reason});return box}
      const value=Promise.resolve(1);value.constructor={[Symbol.species]:Custom};
      const result=value.then(()=>{throw marker});try{await result}catch{}
      return result===box && box.error===marker`
  },
  {
    name: "finally uses the captured species for cleanup resolution",
    source: `let constructions=0, cleanup=0;
      function Custom(executor){constructions++;return new Promise(executor)}
      const value=Promise.resolve(42);value.constructor={[Symbol.species]:Custom};
      const result=value.finally(()=>{cleanup++;return 99});
      return (await result)===42 && cleanup===1 && constructions===2`
  },
  {
    name: "finally invokes a cleanup promise own then",
    source: `const cleanup=Promise.resolve(1);let calls=0;
      cleanup.then=function(restore){calls++;return restore()};
      return (await Promise.resolve(42).finally(()=>cleanup))===42 && calls===1`
  },
  {
    name: "Promise exposes a receiver-sensitive species getter",
    source: `const descriptor=Object.getOwnPropertyDescriptor(Promise,Symbol.species), receiver={};
      return descriptor!==undefined && typeof descriptor.get==="function" && descriptor.get.call(receiver)===receiver && descriptor.enumerable===false && descriptor.configurable===true`
  }
];

it.each(cases)("matches native JavaScript: $name", async ({ source }) => {
  const native = await new Function(`return (async()=>{${source}})()`)();
  expect(native).toBe(true);
  const result = await run(source);
  expect(result.returnValue === true).toBe(true);
});

it.each(["pending", "completed"])("preserves custom species across %s replay checkpoints", async mode => {
  const source = `let calls=0;
    function Custom(executor){calls++;return new Promise(executor)}
    const value=Promise.resolve(41);value.constructor={[Symbol.species]:Custom};
    await 0;
    const answer=await value.then(x=>x+1);
    return answer===42 && calls===1`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: true });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: true });
  } finally {
    await completed;
  }
});

it("keeps budget exhaustion fatal in custom species reactions", async () => {
  await expect(run(`
    function Custom(executor){return new Promise(executor)}
    const value=Promise.resolve(1);value.constructor={[Symbol.species]:Custom};
    try {await value.then(()=>{while(true){}})}catch{return "swallowed"}
  `, { budget: new Budget({ maxSteps: 200 }) })).rejects.toMatchObject({
    name: "SandboxError", code: "budgetExceeded", budget: "steps"
  });
});
