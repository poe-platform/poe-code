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
    expect(encoding).toBe("custom");expect(input).not.toBe(source);expect(input).toEqual(new TextEncoder().encode('# coding: custom\npass\n'));
    meter.checkpoint();input.fill(0);return "pass";
  })).toBe("pass");
  expect(source).toEqual(before);
});
it.each(["exec","eval"] as const)("supplies tokenizer newline translation to source decoders in %s mode",mode=>{
  for(const ending of ["","\n","\r","\r\n"]){
    const source=new TextEncoder().encode(`# coding: custom\r\nvalue = 1${ending}`);
    const expected=new TextEncoder().encode(`# coding: custom\nvalue = 1${mode==="exec"||ending!==""?"\n":""}`);
    const decode=vi.fn((_encoding:string,input:Uint8Array)=>{expect(input).toEqual(expected);return "42";});
    expect(decodeByteSource(source,"source.py",budget(),decode,mode)).toBe("42");
    expect(decode).toHaveBeenCalledOnce();
  }
});
it("does not invoke external codecs for built-in encodings",()=>{
  const decode=vi.fn();
  expect(decodeByteSource(new TextEncoder().encode("pass"),"x.py",budget(),decode)).toBe("pass");
  expect(decode).not.toHaveBeenCalled();
});
it.each(["u8","utf","cp65001","646","cp367","latin","l1","cp819"])("dispatches source alias %s through the supplied codec service",encoding=>{
  const source=new TextEncoder().encode(`# coding: ${encoding}\r\nvalue = 1`);
  const decode=vi.fn((name:string,input:Uint8Array)=>{
    expect(name).toBe(encoding);
    expect(input).toEqual(new TextEncoder().encode(`# coding: ${encoding}\nvalue = 1\n`));
    return "value = 42\n";
  });
  expect(decodeByteSource(source,"source.py",budget(),decode)).toBe("value = 42\n");
  expect(decode).toHaveBeenCalledOnce();
});
it.each(["utf-8","utf8","ascii","us-ascii","latin1","latin-1","iso-8859-1"])("retains source fast path %s with a supplied codec service",encoding=>{
  const text=`# coding: ${encoding}\nvalue = 1`,decode=vi.fn();
  expect(decodeByteSource(new TextEncoder().encode(text),"source.py",budget(),decode)).toBe(text);
  expect(decode).not.toHaveBeenCalled();
});
it("does not fall back to a native alias when the supplied search service declines it",()=>{
  const source=new TextEncoder().encode("# coding: u8\npass"),decode=vi.fn(()=>undefined);
  expect(()=>decodeByteSource(source,"source.py",budget(),decode)).toThrow("unknown encoding: u8");
  expect(decode).toHaveBeenCalledOnce();
});
it.each([false,true])("keeps cancellation in a source alias service terminal (throws=%s)",throws=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:2000000,signal:controller.signal});
  const source=new TextEncoder().encode("# coding: cp819\npass");
  expect(()=>decodeByteSource(source,"source.py",meter,()=>{
    controller.abort();
    if(throws)throw new Error("decoder failure");
    return "pass";
  })).toThrow(ExecutionLimitError);
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
