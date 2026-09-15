import {expect,it,vi} from "vitest";
import {PythonSource} from "./source.js";
import {Interpolation} from "./interpolation.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

function fixture(text:string){
  let active=false,positionRead=false;
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:0});
  const source=new PythonSource(text,"<interpolation>",{checkpoint:(steps,bytes)=>{if(active&&!positionRead)meter.checkpoint(steps,bytes);}});
  const getter=Object.getOwnPropertyDescriptor(PythonSource.prototype,"position")!.get!;
  const spy=vi.spyOn(PythonSource.prototype,"position","get").mockImplementation(function(this:PythonSource){positionRead=true;try{return getter.call(this);}finally{positionRead=false;}});
  return {source,activate:()=>{active=true;},restore:()=>spy.mockRestore()};
}
it.each(['f""','t""','rf""','tr""','f""""""'])("charges quoted interpolation mode storage: %s",text=>{
  const test=fixture(text),interpolation=new Interpolation();test.activate();
  try{expect(()=>interpolation.begin(test.source)).toThrow(ExecutionLimitError);}finally{test.restore();}
});
it.each(['f"abc"','t"abc"','f""','f"{{}}"','f"{x}"','f"""a\nb"""'])("charges interpolation text/boundary storage: %s",text=>{
  const test=fixture(text),interpolation=new Interpolation();interpolation.begin(test.source);test.activate();
  try{expect(()=>interpolation.readText(test.source,0)).toThrow(ExecutionLimitError);}finally{test.restore();}
});
it.each([":","}"])("charges expression boundary storage: %s",boundary=>{
  const test=fixture('f"{x'+boundary+'"'),interpolation=new Interpolation();interpolation.begin(test.source);interpolation.readText(test.source,0);test.source.advance();test.activate();
  try{expect(()=>interpolation.boundary(test.source,0)).toThrow(ExecutionLimitError);}finally{test.restore();}
});
it("reserves the final interpolation buffer after warning callbacks",()=>{
  const test=fixture('f"\\q"'),interpolation=new Interpolation();interpolation.begin(test.source);
  try{expect(()=>interpolation.readText(test.source,0,test.activate)).toThrow(ExecutionLimitError);}finally{test.restore();}
});
it("preserves cancellation from a throwing interpolation warning",()=>{
  const controller=new AbortController(),source=new PythonSource('f"\\q"',"<interpolation>",new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100000,signal:controller.signal})),interpolation=new Interpolation();interpolation.begin(source);
  expect(()=>interpolation.readText(source,0,()=>{controller.abort();throw new Error("warning failure");})).toThrow(ExecutionLimitError);
});
it("charges initial interpolation mode storage",()=>{
  expect(()=>new Interpolation(new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:0}))).toThrow(ExecutionLimitError);
});
