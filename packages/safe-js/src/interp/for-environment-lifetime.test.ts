import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { interpret } from "./interpreter.js";
import { isSandboxPromise } from "./values.js";
import { parseModule } from "../parse/parser.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it("separates initializer closures from test, body and increment environments", async () => {
  const source=`const init=[],test=[],body=[],update=[];
    for(let i=0,f=()=>i;(test.push(()=>i),i<2);(update.push(()=>i),i++)){
      init.push(f);body.push(()=>i);
    }return [init,test,body,update].map(list=>list.map(f=>f()));`;
  const expected=[[0,0],[0,1,2],[0,1],[1,2]];
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});

it("shares the test environment with the statement body", async () => {
  const source=`let before,test,body,after;let run=true;
    for(let x='outside',f=before=()=>x;run&&(x='inside',test=()=>x);after=()=>x)
      body=()=>x,run=false;
    return [before(),test(),body(),after()];`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:["outside","inside","inside","inside"]});
});

it.each([false,true])("preserves loop closure environments through every generator phase (async=%s)", async async => {
  const source=`{${async?'async ':''}function* values(){const init=[],test=[],body=[],update=[];
    for(let i=0,f=()=>i;(test.push(()=>i),yield 'test',i<2);(update.push(()=>i),yield 'update',i++)){
      init.push(f);body.push(()=>i);yield 'body';
    }return [init,test,body,update].map(list=>list.map(f=>f()));}
    const iterator=values();await iterator.next();return iterator;}`;
  const ast=parseModule(source);const original=await interpret(ast.body[0]);
  if(!original.ok)throw new Error(original.error.message);
  let iterator=original.returnValue;
  const native=await runInNewContext(`(async()=>${source})()`);
  for(let i=0;i<8;i++){
    const wire=serialize({source,currentAstNodeId:ast.body[0].nodeId!,
      scopeChain:[{id:"external",bindings:{iterator}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(JSON.parse(JSON.stringify(wire)),{source});
    const binding=restored.currentScope.lookup("iterator");
    if(!binding.found)throw new Error("Missing restored iterator");
    iterator=binding.value;
    const next=await interpret(parseModule("{return iterator.next()}").body[0],{budget:restored.budget,bindings:{iterator}});
    if(!next.ok)throw new Error(next.error.message);
    const actual=isSandboxPromise(next.returnValue)?await next.returnValue.promise:next.returnValue;
    expect(actual).toEqual(await native.next());
  }
});
