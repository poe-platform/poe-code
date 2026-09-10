import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { interpret } from "../interp/interpreter.js";
import { isSandboxPromise } from "../interp/values.js";
import { parseModule } from "../parse/parser.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";

it.each([
  {loop:"in",async:false}, {loop:"of",async:false},
  {loop:"in",async:true}, {loop:"of",async:true}, {loop:"await of",async:true}
])("restores closures captured before header suspension: $loop (async=$async)", async ({loop,async})=>{
  const source=`{${async?'async ':''}function* values(){let x='outside';let before,after;const result=[];
    for ${loop==='await of'?'await ':''}(let x ${loop==='in'?'in':'of'} (before=()=>x,yield 'pause',after=()=>x,${loop==='in'?'{a:1}':'["a"]'}))result.push(x);
    for(const probe of [before,after]){try{result.push(probe())}catch(error){result.push(error.name)}}
    return [x,result]}
    const iterator=values();await iterator.next();return iterator}`;
  const ast=parseModule(source);
  const original=await interpret(ast.body[0]);
  if(!original.ok)throw new Error(original.error.message);
  const wire=serialize({source,currentAstNodeId:ast.body[0].nodeId!,scopeChain:[{id:"external",bindings:{iterator:original.returnValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const restored=restore(JSON.parse(JSON.stringify(wire)),{source});
  const binding=restored.currentScope.lookup("iterator");
  if(!binding.found)throw new Error("Missing restored iterator");
  const next=await interpret(parseModule("{return iterator.next()}").body[0],{budget:restored.budget,bindings:{iterator:binding.value}});
  if(!next.ok)throw new Error(next.error.message);
  const actual=isSandboxPromise(next.returnValue)?await next.returnValue.promise:next.returnValue;
  const native=await runInNewContext(`(async()=>${source})()`);
  expect(actual).toEqual(await native.next());
});
