import { expect, it } from "vitest";
import { run } from "../../run.js";
import { isSandboxClosure } from "../values.js";

it.each(["toArray","reduce","forEach","some","every","find"].flatMap(method =>
  ["receiver","next","result","callback"].filter(kind=>method!=="toArray"||kind!=="callback").map(kind=>({method,kind}))
))("dispatches SDK Iterator $method Proxy $kind", async ({method,kind}) => {
  const callback = method === "reduce" ? "(a,x)=>a+x" : "x=>x>0";
  const setup = `let i=0;const next=function(){if(i>3)throw Error("unexpected extra next");const result={done:i===2,value:++i};return ${kind==="result"?"new Proxy(result,{})":"result"}};const raw={next:${kind==="next"?"new Proxy(next,{})":"next"},return(){return {done:true}}};const input=${kind==="receiver"?"new Proxy(raw,{})":"raw"};const callback=${kind==="callback"?`new Proxy(${callback},{})`:callback};`;
  const native = new Function(`${setup}return Iterator.prototype.${method}.call(input${method==="toArray"?"":",callback"})`)();
  const values = (await run(`${setup}return [Iterator.prototype.${method},input,callback]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Expected SDK consumer");
  expect(await values[0].call(method==="toArray"?[]:[values[2]], {stack:[],thisValue:values[1]})).toEqual(native);
});

it.each(["some","every","find","forEach","reduce"])("closes SDK Proxy iterators with native order: %s", async method => {
  const setup = `const events=[];const input=new Proxy({next(){events.push(this===input?"next":"wrong receiver");return {done:false,value:7}},return:new Proxy(function(){events.push(this===input?"return":"wrong receiver");return {done:true}}, {})},{});const callback=new Proxy((...args)=>{events.push(args);${method==="forEach"||method==="reduce"?'throw "stop"':`return ${method!=="every"}`}},{});`;
  const native = new Function(`${setup}let output;try{output=Iterator.prototype.${method}.call(input,callback,0)}catch(error){output=error}return [output,events]`)();
  const values = (await run(`${setup}return [Iterator.prototype.${method},input,callback,events]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Expected SDK consumer");
  let output;
  try { output=await values[0].call([values[2],0], {stack:[],thisValue:values[1]}); }
  catch(error) { output=error; }
  expect([output,values[3]]).toEqual(native);
});
