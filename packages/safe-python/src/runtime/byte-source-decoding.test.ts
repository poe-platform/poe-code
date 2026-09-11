import {expect,it,vi} from "vitest";
import {decodeByteSource} from "./byte-source-decoding.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonSyntaxError} from "../source.js";

const budget=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:2000000});
it.each(["utf--8","__ascii__","iso---8859__1","latin__1"])("normalizes codec-name separators: %s",encoding=>{
  const text=`# coding: ${encoding}\npass`;
  expect(decodeByteSource(new TextEncoder().encode(text),"x.py",budget())).toBe(text);
});
it("isolates the caller's bytes from a custom codec",()=>{
  const source=new TextEncoder().encode('# coding: custom\npass'),before=source.slice();
  expect(decodeByteSource(source,"x.py",budget(),(encoding,input,meter)=>{
    expect(encoding).toBe("custom");expect(input).not.toBe(source);expect(input).toEqual(before);
    meter.checkpoint();input.fill(0);return "pass";
  })).toBe("pass");
  expect(source).toEqual(before);
});
it("does not invoke external codecs for built-in encodings",()=>{
  const decode=vi.fn();
  expect(decodeByteSource(new TextEncoder().encode("pass"),"x.py",budget(),decode)).toBe("pass");
  expect(decode).not.toHaveBeenCalled();
});
it("translates custom decode faults without hiding unrelated failures",()=>{
  const source=new TextEncoder().encode('# coding: custom\npass'),failure=new Error("host failure");
  expect(()=>decodeByteSource(source,"x.py",budget(),()=>{throw new PythonDecodeError("custom",source,0,1,"bad byte");})).toThrow(PythonSyntaxError);
  expect(()=>decodeByteSource(source,"x.py",budget(),()=>{throw failure;})).toThrow(failure);
});
it("rejects unknown encodings when the custom registry declines them",()=>{
  expect(()=>decodeByteSource(new TextEncoder().encode('# coding: absent\npass'),"x.py",budget(),()=>undefined)).toThrow("unknown encoding: absent");
});
it.each([{maxSteps:10,maxAllocatedBytes:1000000},{maxSteps:1000000,maxAllocatedBytes:32}])("bounds byte decoding with %j",limits=>{
  expect(()=>decodeByteSource(new Uint8Array(1000).fill(65),"x.py",new ExecutionBudget(limits))).toThrow(ExecutionLimitError);
});
it("reserves output before decoding rather than after producing text",()=>{
  const source=new TextEncoder().encode("pass"),meter=budget();decodeByteSource(source,"x",meter);
  expect(()=>decodeByteSource(source,"x",new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:meter.usage.allocatedBytes-1}))).toThrow(ExecutionLimitError);
});
