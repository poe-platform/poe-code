import {expect,it} from "vitest";
import {compileSourceProgram} from "./source-program-compilation.js";
import {createFunctionState} from "./function-state.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {runtimeNativeAttribute} from "./runtime-native-attribute.js";
import {OrderedKeyMap} from "./ordered-key-map.js";

function fixture(){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}),v=new RuntimeValues(meter);
  const object=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>1n,equal:(a,b)=>a===b},meter));
  const globals=Object.assign(new Map<string,RuntimeValue>(),{object}),builtins=Object.assign(new Map<string,RuntimeValue>(),{object:v.none});
  const program=compileSourceProgram("def f():pass",{stripDocstring:false,enterRecursiveCall:()=>()=>{}},v,meter);
  const fn=v.function(createFunctionState([...program.functions.values()][0],new Map(),{globals,builtins,none:v.none},meter));
  return {controller,meter,v,fn,globals,builtins};
}
it.each(["__globals__","__builtins__"] as const)("retains original %s identity over ordinary attributes",name=>{
  const {meter,v,fn,globals,builtins}=fixture();fn.value.attributes.set(name,v.false);
  expect(runtimeNativeAttribute(fn,name,v,meter)).toBe(name==="__globals__"?globals.object:builtins.object);
});
it.each([false,true])("keeps cancellation fatal after namespace identity lookup (throws=%s)",throws=>{
  const {controller,meter,v,fn,globals}=fixture();
  Object.defineProperty(globals,"object",{get(){controller.abort();if(throws)throw Error("identity failed");return v.none;}});
  expect(()=>runtimeNativeAttribute(fn,"__globals__",v,meter)).toThrow(ExecutionLimitError);
});
it("does not fabricate guest dictionaries for host-only namespaces",()=>{
  const {meter,v,fn,globals}=fixture();Reflect.deleteProperty(globals,"object");
  expect(()=>runtimeNativeAttribute(fn,"__globals__",v,meter)).toThrow("function namespace reflection requires an original guest object");
});
