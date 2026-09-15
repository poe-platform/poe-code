import {expect,it} from "vitest";
import {compileSourceProgram} from "./source-program-compilation.js";
import {createFunctionFrame} from "./function-frame.js";
import {ExecutionBudget} from "./execution-budget.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter);
  const program=compileSourceProgram("def outer(x):return (x+y for y in ())",{stripDocstring:false,enterRecursiveCall:()=>()=>{}},v,meter);
  const code=[...program.generatorExpressions!.values()][0],owner=code.scope.free.get("x")!;
  const cell={owner,content:{value:v.integer(7)}};
  const context={globals:new Map<string,RuntimeValue>(),builtins:new Map<string,RuntimeValue>(),closure:new Map([["x",cell]]),tuple:(items:readonly RuntimeValue[])=>v.tuple(items),dictionary:()=>{throw Error("unexpected variadic keywords");}};
  const call=(positional:RuntimeValue[],keywords=new Map<string,RuntimeValue>(),defaults?:readonly RuntimeValue[])=>createFunctionFrame(code.scope,{name:"<genexpr>",positional,keywords,defaults:new Map(),defaultOverrides:defaults===undefined?undefined:{positional:defaults}},context,meter,code.localLayout,code);
  return {v,code,cell,call};
}
it("binds the original implicit iterator argument and retained closure without iterating",()=>{
  const {v,code,cell,call}=fixture(),argument=v.none,frame=call([argument]);
  expect(frame.code).toBe(code);expect(frame.load(".0")).toBe(argument);expect(frame.load("x")).toBe(cell.content.value);
  cell.content={value:v.integer(8)};expect(frame.load("x")).toEqual(v.integer(8));
});
it("accepts the real .0 keyword, not inspect's display name",()=>{
  const {v,call}=fixture();expect(call([],new Map([[".0",v.true]])).load(".0")).toBe(v.true);
  expect(()=>call([],new Map([["implicit0",v.true]]))).toThrow("<genexpr>() got an unexpected keyword argument 'implicit0'");
});
it("uses ordinary argument validation and positional default overrides",()=>{
  const {v,call}=fixture();
  expect(()=>call([])).toThrow("<genexpr>() missing 1 required positional argument: '.0'");
  expect(()=>call([v.none,v.none])).toThrow("<genexpr>() takes 1 positional argument but 2 were given");
  expect(()=>call([v.none],new Map([[".0",v.true]]))).toThrow("<genexpr>() got multiple values for argument '.0'");
  expect(call([],new Map(),[v.true]).load(".0")).toBe(v.true);
});
