import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { deepCopyFromSandbox } from "./values.js";

it.each(["next", "throw", "return"].flatMap(operation => [false, true].map(done => ({ operation, done }))))(
  "preserves delegated $operation results with done=$done", async ({ operation, done }) => {
    const source = `const events=[];const result=Object.defineProperties(Object.create(null),{value:{get(){events.push("value");return 9},enumerable:true},done:{value:${done},enumerable:true},extra:{value:7,enumerable:true}});const input={[Symbol.iterator](){return this},next(){return ${operation === "next" ? "result" : "{value:1,done:false}"}},throw(value){events.push(["throw",value]);return result},return(value){events.push(["return",value]);return result}};const generator=(function*(){return yield*input})();${operation === "next" ? "" : "generator.next();"}const actual=generator.${operation}(4);return [actual===result,Object.getPrototypeOf(actual)===null,events,actual.done,actual.extra,Reflect.ownKeys(actual)]`;
    const expected = runInNewContext(`(()=>{${source}})()`);
    const actual = await run(source);
    expect(actual.ok).toBe(true);
    expect(deepCopyFromSandbox(actual.returnValue)).toEqual(expected);
  }
);

it("does not read a throwing value getter before yielding a delegated result", async () => {
  const source = `const events=[];const result={get value(){events.push("value");throw "boom"},done:false};const input={[Symbol.iterator](){return this},next(){return result}};const generator=(function*(){yield*input})();try{const actual=generator.next();return ["yielded",events,actual===result]}catch(error){return ["threw",events,String(error)]}`;
  expect(deepCopyFromSandbox((await run(source)).returnValue)).toEqual(runInNewContext(`(()=>{${source}})()`));
});

it.each(["mutate", "revoke"])("preserves delegated Proxy result identity: %s", async mode => {
  const source = `const pair=Proxy.revocable({value:1,done:false},{});const input={[Symbol.iterator](){return this},next(){return pair.proxy}};const generator=(function*(){yield*input})();const result=generator.next();${mode === "mutate" ? "pair.proxy.value=9;return [result===pair.proxy,result.value]" : "pair.revoke();try{return [result===pair.proxy,result.value]}catch(error){return [result===pair.proxy,error.name]}"}`;
  expect(deepCopyFromSandbox((await run(source)).returnValue)).toEqual(runInNewContext(`(()=>{${source}})()`));
});

it("unwraps async delegated values instead of forwarding synchronous result records", async () => {
  const source = `const events=[];const result=Object.defineProperties(Object.create(null),{value:{get(){events.push("value");return 7},enumerable:true},done:{value:false,enumerable:true},extra:{value:9,enumerable:true}});const input={[Symbol.iterator](){return this},next(){return result}};const generator=(async function*(){yield*input})();const actual=await generator.next();return [actual===result,Object.getPrototypeOf(actual)===Object.prototype,actual.value,actual.extra,events,Reflect.ownKeys(actual)]`;
  expect(deepCopyFromSandbox((await run(source)).returnValue)).toEqual(await runInNewContext(`(async()=>{${source}})()`));
});

it.each(["next", "throw", "return"])("preserves delegated Proxy results and getter order through replay: %s", async operation => {
  const source = `const events=[];const result=new Proxy({get value(){events.push("value");return 7},get done(){events.push("done");return false}},{});const input={[Symbol.iterator](){return this},next(){return result},throw(){return result},return(){return result}};const generator=(function*(){yield*input})();const first=generator.next();await 0;const second=generator.${operation}(9);return [first===result,second===result,events]`;
  const expected = await runInNewContext(`(async()=>{${source}})()`);
  const original = await run(source);
  expect(original.ok).toBe(true);
  expect(deepCopyFromSandbox(original.returnValue)).toEqual(expected);
  const replayed = await run(source, { snapshot: JSON.parse(await dump(original)) });
  expect(replayed.ok).toBe(true);
  expect(deepCopyFromSandbox(replayed.returnValue)).toEqual(expected);
});
