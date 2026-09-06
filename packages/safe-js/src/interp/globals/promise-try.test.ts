import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";

it("invokes the callback synchronously with arguments and undefined this", async () => {
  expect((await run(`const events=[];
    const pending=Promise.try(function(a,b){events.push("callback");return this===undefined?a+b:0},20,22);
    events.push("after");return events.join(",")==="callback,after" && (await pending)===42;`)).returnValue).toBe(true);
});

it("rejects with the original thrown value", async () => {
  expect((await run(`const reason={label:42},pending=Promise.try(()=>{throw reason});
    try{await pending;return false}catch(error){return error===reason}`)).returnValue).toBe(true);
});

it("turns noncallable callbacks into rejected promises", async () => {
  expect((await run(`const pending=Promise.try(1);
    try{await pending;return false}catch(error){return error instanceof TypeError}`)).returnValue).toBe(true);
});

it("uses the subclass capability", async () => {
  expect((await run(`class Child extends Promise {};const pending=Child.try(()=>42);
    return pending instanceof Child && (await pending)===42;`)).returnValue).toBe(true);
});

it("constructs the capability before calling the callback per ECMAScript 2026", async () => {
  expect((await run(`const events=[];function Custom(executor){events.push("construct");
      executor(value=>events.push(value),reason=>events.push("reject"));}
    const result=Promise.try.call(Custom,()=>{events.push("callback");return 42});
    return result instanceof Custom && events.join(",")==="construct,callback,42";`)).returnValue).toBe(true);
});

it("does not call the callback if capability construction fails", async () => {
  expect((await run(`if(typeof Promise.try!=="function")return false;
    let called=false;function Invalid(){throw 17}
    try{Promise.try.call(Invalid,()=>{called=true});return false}
    catch(error){return error===17 && !called}`)).returnValue).toBe(true);
});

it("assimilates callback thenables", async () => {
  expect((await run(`return await Promise.try(()=>({then(resolve){resolve(42)}}));`)).returnValue).toBe(42);
});

it("exposes standard method metadata", async () => {
  expect((await run(`if(typeof Promise.try!=="function")return false;
    const descriptor=Object.getOwnPropertyDescriptor(Promise,"try");
    return Promise.try.name==="try" && Promise.try.length===1 &&
      descriptor.writable && descriptor.configurable && !descriptor.enumerable;`)).returnValue).toBe(true);
});

it("creates a fresh promise even when the callback returns an intrinsic promise", async () => {
  expect((await run(`const value=Promise.resolve(42),result=Promise.try(()=>value);
    return result!==value && (await result)===42;`)).returnValue).toBe(true);
});

it("passes raw callback values to generic resolvers", async () => {
  expect((await run(`function Custom(executor){executor(value=>{this.value=value},()=>{})}
    const value=Promise.resolve(42),result=Promise.try.call(Custom,()=>value);
    return result.value===value;`)).returnValue).toBe(true);
});

it("assimilates async callbacks", async () => {
  expect((await run(`return await Promise.try(async()=>{await 0;return 42});`)).returnValue).toBe(42);
});

it("propagates exceptions thrown by custom resolving functions", async () => {
  expect((await run(`function Custom(executor){executor(()=>{throw 17},()=>{throw 18})}
    try{Promise.try.call(Custom,()=>42);return false}catch(error){return error===17}`)).returnValue).toBe(true);
});

it("keeps callback budget failures fatal", async () => {
  await expect(run(`try{await Promise.try(()=>{while(true){}})}catch(error){return "swallowed"}`,
    { budget: new Budget({ maxSteps: 128 }) })).rejects.toMatchObject({ code: "budgetExceeded" });
});

it("runs the callback before already queued Promise jobs", async () => {
  expect((await run(`const events=[];Promise.resolve().then(()=>events.push("job"));
    Promise.try(()=>events.push("callback"));events.push("after");await 0;
    return events.join(",");`)).returnValue).toBe("callback,after,job");
});

it.each(["pending", "completed"])("replays Promise.try across %s checkpoints", async mode => {
  const source = `const result=Promise.try(()=>42);await 0;return await result;`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: 42 });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: 42 });
  } finally { await completed; }
});
