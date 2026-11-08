import {expect,it} from "vitest";
import {executeTest262} from "./execute.js";
const harness=new Map([["assert.js",""],["sta.js",""]]);

it("executes module fixtures under the module parse goal",async()=>{
  expect(await executeTest262("early.js","/*---\nflags: [module]\nnegative: {phase: parse, type: SyntaxError}\n---*/\nexport default 1; export default 2",{harness,timeoutMs:1000}))
    .toMatchObject({results:[{mode:"module",status:"passed"}]});
  expect(await executeTest262("valid.js","/*---\nflags: [module]\n---*/\nif(this!==undefined)throw 1;export default 1",{harness,timeoutMs:1000}))
    .toMatchObject({results:[{mode:"module",status:"passed"}]});
});

it("executes a granted multi-source module fixture",async()=>{
  const sourceResolver=(specifier:string)=>specifier==="dep"?{id:"dep",source:"export let x=1;export function inc(){x++}"}:undefined;
  expect(await executeTest262("entry.js","/*---\nflags: [module]\n---*/\nimport {x,inc} from 'dep';inc();if(x!==2)throw 1",{harness,timeoutMs:1000,sourceResolver}))
    .toMatchObject({results:[{status:"passed"}]});
});

it("classifies unresolved exports as resolution errors",async()=>{
  expect(await executeTest262("entry.js","/*---\nflags: [module]\nnegative: {phase: resolution, type: SyntaxError}\n---*/\nimport {missing} from 'dep'",{
    harness,timeoutMs:1000,sourceResolver:()=>({id:"dep",source:"export const x=1"})}))
    .toMatchObject({results:[{status:"passed"}]});
});
