import { expect, it } from "vitest";
import { run } from "../run.js";

it("unwinds an async function awaiting a pending guest promise on cancellation", async () => {
  const controller = new AbortController();
  let entered!: () => void;
  const started = new Promise<void>(resolve => {entered = resolve;});
  const pending = run(`let cleaned=false;async function main(){try{entered();await new Promise(()=>{})}finally{cleaned=true}}
    try{await main()}catch(error){return [cleaned,error.message]}`, {signal: controller.signal, bindings:{entered}});
  await started;
  controller.abort(new Error('stop'));
  expect(await pending).toMatchObject({ok:true,returnValue:[true,'stop']});
});

it("unwinds an async generator awaiting a pending guest promise on cancellation", async () => {
  const controller = new AbortController();
  let entered!: () => void;
  const started = new Promise<void>(resolve => {entered = resolve;});
  const pending = run(`let cleaned=false;async function* main(){try{entered();await new Promise(()=>{});yield 1}finally{cleaned=true}}
    try{await main().next()}catch(error){return [cleaned,error.message]}`, {signal: controller.signal, bindings:{entered}});
  await started;
  controller.abort(new Error('stop'));
  expect(await pending).toMatchObject({ok:true,returnValue:[true,'stop']});
});
