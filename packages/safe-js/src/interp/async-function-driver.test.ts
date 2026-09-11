import { expect, it } from "vitest";
import { run } from "../run.js";

it("throws failed Await promise resolution into the function before suspending", async () => {
  expect(await run(`const events=[];const p=Promise.resolve(1);Object.defineProperty(p,'constructor',{get(){throw 'failure'}});
    async function f(){try{await p}catch(e){events.push(e)}}const pending=f();events.push('caller');await pending;return events;`))
    .toMatchObject({ok:true,returnValue:['failure','caller']});
});

it("starts a nested async function after its caller resumes", async () => {
  expect(await run("async function child(){await 0;return 42} async function parent(){await 0;return await child()} return await parent()"))
    .toMatchObject({ok:true,returnValue:42});
});
