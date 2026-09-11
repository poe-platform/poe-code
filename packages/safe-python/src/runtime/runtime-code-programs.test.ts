import {expect,it} from "vitest";
import {RuntimeCodePrograms} from "./runtime-code-programs.js";
import {compileSourceProgram} from "./source-program-compilation.js";
import {RuntimeValues} from "./runtime-values.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:2000000}),v=new RuntimeValues(meter);
  const program=compileSourceProgram("def f():return 1\nclass C:\n def method(self):return 2\ng=(x for x in (1,))",{stripDocstring:false,enterRecursiveCall:()=>()=>{}},v,meter);
  return {meter,program,v};
}
it("associates all compiled code identities with their originating program",()=>{
  const {meter,program,v}=fixture(),registry=new RuntimeCodePrograms(meter,v);
  expect(registry.lookup(program.module)).toBeUndefined();registry.register(program);
  for(const code of [program.module,...program.functions.values(),...program.classes.values(),...program.classFunctions.values(),...program.generatorExpressions!.values()])expect(registry.lookup(code)).toBe(program);
  expect(registry.lookup({...program.module})).toBeUndefined();
  registry.register(program);expect(registry.lookup(program.module)).toBe(program);
});
it("resolves original class suites to their compiler-owned callable wrappers",()=>{
  const {meter,program,v}=fixture(),registry=new RuntimeCodePrograms(meter,v),code=[...program.classes.values()][0],wrapper=[...program.classFunctions.values()][0];
  expect(registry.functionCode(code)).toBeUndefined();registry.register(program);
  expect(registry.functionCode(code)).toBe(wrapper);expect(registry.functionCode(wrapper)).toBe(wrapper);
  expect(registry.functionCode({...code})).toBeUndefined();
  expect(registry.functionCode([...program.functions.values()][0])).toBe([...program.functions.values()][0]);
});
it("caches module callable adapters retaining the original program and code",()=>{
  const {meter,program,v}=fixture(),registry=new RuntimeCodePrograms(meter,v);
  expect(registry.functionCode(program.module)).toBeUndefined();registry.register(program);
  const wrapper=registry.functionCode(program.module)!;
  expect(wrapper.body).toEqual({kind:"module",program});expect(wrapper.scope).toBe(program.module.scope);
  expect(wrapper.source).toBe(program.module.source);expect(registry.functionCode(program.module)).toBe(wrapper);
  expect(registry.functionCode({...program.module})).toBeUndefined();
});
it("does not publish a module adapter after allocation fails",()=>{
  const {program,v}=fixture();let fail=false;
  const registry=new RuntimeCodePrograms({checkpoint(_steps,bytes=0){if(fail&&bytes)throw new ExecutionLimitError("allocation");}},v);
  registry.register(program);fail=true;expect(()=>registry.functionCode(program.module)).toThrow(ExecutionLimitError);
  fail=false;const wrapper=registry.functionCode(program.module);expect(wrapper).toBeDefined();expect(registry.functionCode(program.module)).toBe(wrapper);
});
it("rejects conflicting associations without publishing any partial entries",()=>{
  const {meter,program,v}=fixture(),registry=new RuntimeCodePrograms(meter,v);registry.register(program);
  const other={...program,module:{...program.module}};
  expect(()=>registry.register(other)).toThrow("compiled code already belongs to another program");
  expect(registry.lookup(other.module)).toBeUndefined();expect(registry.lookup(program.module)).toBe(program);
});
it.each([2,4,9])("does not publish code associations after a resource failure at checkpoint %s",limit=>{
  const {program,v}=fixture();let remaining=limit;
  const registry=new RuntimeCodePrograms({checkpoint(){if(--remaining<0)throw new ExecutionLimitError("steps");}},v);
  expect(()=>registry.register(program)).toThrow(ExecutionLimitError);
  remaining=100;expect(registry.lookup(program.module)).toBeUndefined();
});
