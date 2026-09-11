import {expect,it,vi} from "vitest";
import {parseModule} from "./module.js";
import {collectSymbols} from "./symbol-collection.js";
import {validateDeclarations} from "./declaration-validation.js";
import * as declarations from "./declaration-validation.js";
import {resolveSymbols} from "./symbol-resolution.js";
import {analyzeModule} from "./analysis.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["steps","allocation","cancelled"] as const)("checks declaration entry %s limits",reason=>{
  const root=collectSymbols(parseModule("pass")),controller=new AbortController();if(reason==="cancelled")controller.abort();
  const meter=new ExecutionBudget({maxSteps:reason==="steps"?0:10000,maxAllocatedBytes:reason==="allocation"?0:100000,signal:controller.signal});
  expect(()=>validateDeclarations(root,"<string>",meter)).toThrow(ExecutionLimitError);
});
it("validates 10000 nested scopes without host recursion",()=>{
  const root=collectSymbols(parseModule("def f():pass")),child=root.children[0];let nested=child;
  for(let i=0;i<10000;i++)nested={...child,children:[nested]};
  expect(()=>validateDeclarations({...root,children:[nested]},"<string>",new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:10000000}))).not.toThrow();
});
it("meters repeated name events even when no history entries are added",()=>{
  const root=collectSymbols(parseModule("x"));
  expect(()=>validateDeclarations({...root,events:Array(10000).fill(root.events[0])},"<string>",new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("charges conflict diagnostics before constructing them",()=>{
  const root=collectSymbols(parseModule("x=1\nglobal x"));
  expect(()=>validateDeclarations(root,"<string>",{checkpoint(_steps=1,bytes=0){if(bytes>=256)throw new ExecutionLimitError("allocation");}})).toThrow(ExecutionLimitError);
});
it("forwards analysis and resolver meters to declaration validation",()=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),spy=vi.spyOn(declarations,"validateDeclarations");
  try{analyzeModule("pass",{meter});expect(spy.mock.calls[0][2]).toBe(meter);spy.mockClear();resolveSymbols(collectSymbols(parseModule("pass")),"<string>",meter);expect(spy.mock.calls[0][2]).toBe(meter);}finally{spy.mockRestore();}
});
it("reports a nested declaration error before later parent events",()=>{
  const root=collectSymbols(parseModule("def f():\n y=1\n global y\nx=1\nglobal x"));
  expect(()=>validateDeclarations(root,"order.py",new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}))).toThrow(expect.objectContaining({message:"name 'y' is assigned to before global declaration",position:expect.objectContaining({line:3})}));
});
it("bounds cyclic external scopes",()=>{
  const root=collectSymbols(parseModule("pass")),children:typeof root[]=[],cyclic={...root,children};children.push(cyclic);
  expect(()=>validateDeclarations(cyclic,"<string>",new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("bounds distinct name-history allocation",()=>{
  const root=collectSymbols(parseModule("x")),events=Array.from({length:1000},(_,index)=>({...root.events[0],name:`x${index}`}));
  expect(()=>validateDeclarations({...root,events},"<string>",new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000}))).toThrow(ExecutionLimitError);
});
it.each(["global","nonlocal"])("identifies the conflicting %s declaration in annotation errors",kind=>{
  const root=collectSymbols(parseModule(`def f():\n ${kind} x\n x:T`));
  expect(()=>validateDeclarations(root)).toThrow(expect.objectContaining({message:`annotated name 'x' can't be ${kind}`}));
});
it.each(["y=1\n global y","x:T"])("checks later immediate errors before deferred declaration conflicts: %s",tail=>{
  const root=collectSymbols(parseModule("def f():\n global x\n nonlocal x\n "+tail));
  expect(()=>validateDeclarations(root)).toThrow(expect.objectContaining({message:tail==="x:T"?"annotated name 'x' can't be global":"name 'y' is assigned to before global declaration"}));
});
it.each(["global x\nnonlocal x","nonlocal x\nglobal x"])("attributes conflicting declarations to their first directive: %s",body=>{
  const root=collectSymbols(parseModule("def f():\n "+body.split("\n").join("\n ")));
  expect(()=>validateDeclarations(root)).toThrow(expect.objectContaining({message:"name 'x' is nonlocal and global",position:expect.objectContaining({line:2})}));
});
