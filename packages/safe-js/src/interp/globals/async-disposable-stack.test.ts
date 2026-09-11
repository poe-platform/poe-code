import { expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";

it("awaits captured async disposers sequentially in reverse order", async () => {
  expect(await run(`const calls=[];const stack=new AsyncDisposableStack();
    const resource={get [Symbol.asyncDispose](){calls.push('get');return async function(){calls.push(this===resource);await 0;calls.push('resource:end')}}};
    const same=stack.use(resource)===resource;
    Object.defineProperty(resource,Symbol.asyncDispose,{value:()=>{throw 'wrong'}});
    stack.adopt(7,async function(value){calls.push([value,this===undefined]);await 0;calls.push('adopt:end')});
    stack.defer(async()=>{calls.push('defer:start');await 0;calls.push('defer:end')});
    const pending=stack.disposeAsync();const disposed=stack.disposed;await pending;
    return [same,disposed,pending instanceof Promise,calls];`))
    .toMatchObject({ok:true,returnValue:[true,true,true,['get','defer:start','defer:end',[7,true],'adopt:end',true,'resource:end']]});
});

it("prefers async methods and ignores promises returned by sync fallbacks", async () => {
  expect(await run(`const calls=[];const stack=new AsyncDisposableStack();
    stack.use({[Symbol.asyncDispose](){calls.push('async')},get [Symbol.dispose](){throw 'wrong'}});
    stack.use({[Symbol.dispose](){calls.push('sync');return new Promise(()=>{})}});
    await stack.disposeAsync();return calls;`)).toMatchObject({ok:true,returnValue:['sync','async']});
});

it("returns rejected promises for invalid receivers and fulfilled promises for repeated disposal", async () => {
  expect(await run(`let result;try{result=AsyncDisposableStack.prototype.disposeAsync.call({})}catch(e){return 'synchronous'};
    let error;try{await result}catch(e){error=e.name};
    const stack=new AsyncDisposableStack();const first=stack.disposeAsync();const second=stack.disposeAsync();
    return [result instanceof Promise,error,first!==second,await first,await second];`))
    .toMatchObject({ok:true,returnValue:[true,'TypeError',true,undefined,undefined]});
});

it("combines rejection and synchronous throw payloads while continuing cleanup", async () => {
  expect(await run(`const stack=new AsyncDisposableStack();const first={},second={};const calls=[];
    stack.defer(()=>{calls.push(1);throw first});stack.defer(async()=>{calls.push(2);throw second});
    try{await stack.disposeAsync()}catch(e){return [calls,e instanceof SuppressedError,e.error===first,e.suppressed===second,stack.disposed]}`))
    .toMatchObject({ok:true,returnValue:[[2,1],true,true,true,true]});
});

it("moves resources into a fresh intrinsic async stack", async () => {
  expect(await run(`class Child extends AsyncDisposableStack{};const original=new Child();const calls=[];
    original.defer(()=>calls.push(1));const moved=original.move();await original.disposeAsync();
    const before=[original.disposed,moved.disposed,moved instanceof Child,calls.length];
    await moved.disposeAsync();return [before,calls,Object.getPrototypeOf(moved)===AsyncDisposableStack.prototype];`))
    .toMatchObject({ok:true,returnValue:[[true,false,false,0],[1],true]});
});

it("accepts nullish resources and retains the async disposal alias", async () => {
  expect(await run(`const stack=new AsyncDisposableStack();const values=[stack.use(null),stack.use(undefined)];
    await stack[Symbol.asyncDispose]();return [values,stack.disposed,AsyncDisposableStack.prototype[Symbol.asyncDispose]===AsyncDisposableStack.prototype.disposeAsync];`))
    .toMatchObject({ok:true,returnValue:[[null,undefined],true,true]});
});

it("rejects structured cloning of resource owners", async () => {
  expect(await run(`try{structuredClone(new AsyncDisposableStack());return false}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:'DataCloneError'});
});

it("checks the disposed brand before validating methods and values", async () => {
  expect(await run(`const stack=new AsyncDisposableStack();const errors=[];
    for(const value of [1,{}, {[Symbol.asyncDispose]:7}]){try{stack.use(value)}catch(e){errors.push(e.name)}}
    try{stack.defer(null)}catch(e){errors.push(e.name)};try{stack.adopt(1,null)}catch(e){errors.push(e.name)};
    await stack.disposeAsync();for(const name of ['use','adopt','defer','move']){try{stack[name](null,null)}catch(e){errors.push(e.name)}}
    return errors;`)).toMatchObject({ok:true,returnValue:[...Array(5).fill('TypeError'),...Array(4).fill('ReferenceError')]});
});

it("does not wait for in-progress cleanup on a repeated disposeAsync call", async () => {
  expect(await run(`const stack=new AsyncDisposableStack();const c=Promise.withResolvers();stack.defer(()=>c.promise);
    const first=stack.disposeAsync();const second=stack.disposeAsync();await second;c.resolve();await first;
    return [first!==second,stack.disposed];`)).toMatchObject({ok:true,returnValue:[true,true]});
});

it("does not swallow fatal execution budgets during awaited cleanup", async () => {
  await expect(run(`const stack=new AsyncDisposableStack();stack.defer(async()=>{while(true){}});await stack.disposeAsync()`,{budget:new Budget({maxSteps:1000})}))
    .rejects.toThrow('Sandbox budget exceeded for steps');
});

it("runs the disposer prefix before the caller and its continuation afterward", async () => {
  expect(await run(`const events=[];const stack=new AsyncDisposableStack();
    stack.defer(async()=>{events.push(1);await 0;events.push(3)});
    const pending=stack.disposeAsync();events.push(2);await pending;return events;`))
    .toMatchObject({ok:true,returnValue:[1,2,3]});
});
