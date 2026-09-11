import { expect, it } from "vitest";
import { run } from "../run.js";

it("captures disposal methods and cleans up blocks in reverse order", async () => {
  expect(await run(`const events=[];const resource={get [Symbol.dispose](){events.push('get');return function(){events.push(this===resource)}}};
    {using first=resource;using second={[Symbol.dispose](){events.push('second')}};events.push('body')}
    return events;`)).toMatchObject({ok:true,returnValue:['get','body','second',true]});
});

it("disposes function resources before returning without changing the returned object", async () => {
  expect(await run(`const events=[];function f(){using value={[Symbol.dispose](){events.push('disposed')}};return events}return f();`))
    .toMatchObject({ok:true,returnValue:['disposed']});
});

it("combines body and cleanup failures while releasing all resources", async () => {
  expect(await run(`const body={},first={},second={};try{using a={[Symbol.dispose](){throw first}},b={[Symbol.dispose](){throw second}};throw body}
    catch(e){return [e instanceof SuppressedError,e.error===first,e.suppressed.error===second,e.suppressed.suppressed===body]}`))
    .toMatchObject({ok:true,returnValue:[true,true,true,true]});
});

it("releases earlier bindings when a later resource is invalid", async () => {
  expect(await run(`const events=[];try{using a={[Symbol.dispose](){events.push(1)}},b=1}catch(e){events.push(e.name)}return events;`))
    .toMatchObject({ok:true,returnValue:[1,'TypeError']});
});

it("disposes each iteration on continue and break", async () => {
  expect(await run(`const events=[];const values=[1,2,3].map(n=>({n,[Symbol.dispose](){events.push(n)}}));
    for(using value of values){if(value.n===1)continue;break}return events;`))
    .toMatchObject({ok:true,returnValue:[1,2]});
});

it("does not dispose a suspended generator until its scope exits", async () => {
  expect(await run(`const events=[];function* values(){using r={[Symbol.dispose](){events.push(1)}};yield 1}
    const value=values();value.next();const before=events.length;value.return();return [before,events];`))
    .toMatchObject({ok:true,returnValue:[0,[1]]});
});

it("awaits async cleanup and ignores promises from synchronous fallbacks", async () => {
  expect(await run(`const events=[];{await using a={[Symbol.asyncDispose]:async()=>{await 0;events.push('async')}};
    await using b={[Symbol.dispose](){events.push('sync');return new Promise(()=>{})}};events.push('body')}return events;`))
    .toMatchObject({ok:true,returnValue:['body','sync','async']});
});

it("keeps resource bindings immutable", async () => {
  expect(await run(`let error;{using value=null;try{value=1}catch(e){error=e.name}}return error;`))
    .toMatchObject({ok:true,returnValue:'TypeError'});
});

it("disposes classic loop initializers once when the loop exits", async () => {
  expect(await run(`const events=[];for(using r={[Symbol.dispose](){events.push('closed')}};false;){}return events;`))
    .toMatchObject({ok:true,returnValue:['closed']});
});

it("disposes switch resources after fallthrough and break", async () => {
  expect(await run(`const events=[];switch(1){case 1:using r={[Symbol.dispose](){events.push('closed')}};events.push('body');case 2:break}return events;`))
    .toMatchObject({ok:true,returnValue:['body','closed']});
});

it("disposes a single top-level resource declaration", async () => {
  const events: string[] = [];
  expect(await run('using value = {[Symbol.dispose](){effect()}};', {bindings:{effect:()=>events.push('closed')}})).toMatchObject({ok:true});
  expect(events).toEqual(['closed']);
});

it("awaits a nullish async resource before the following synchronous disposal", async () => {
  expect(await run(`const events=[];async function f(){using r={[Symbol.dispose](){events.push('sync')}};await using n=null;}
    const pending=f();events.push('caller');await pending;return events;`))
    .toMatchObject({ok:true,returnValue:['caller','sync']});
});
