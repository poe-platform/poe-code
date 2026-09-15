import {expect,it,vi} from "vitest";
import type {CompileRequest} from "./builtin-compile.js";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodePrograms} from "./runtime-code-programs.js";
import {createRuntimeCompilation,type RuntimeCompilationPolicy} from "./runtime-compilation.js";
import {RuntimeValues} from "./runtime-values.js";

function fixture(){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}),v=new RuntimeValues(meter),programs=new RuntimeCodePrograms(meter,v);
  const compilation=vi.fn(()=>({stripDocstring:false,optimize:2 as const,enterRecursiveCall:()=>()=>{}}));
  const code=vi.fn((code:Parameters<RuntimeCompilationPolicy["code"]>[0])=>{
    expect(programs.lookup(code)?.module).toBe(code);
    return v.integer(code.flags);
  });
  const policy={compilation,code};
  const request:CompileRequest={source:v.string('"doc"\nassert missing()'),filename:"child.py",mode:"exec",flags:0,optimize:-1,featureVersion:-1};
  return {controller,meter,v,programs,policy,request};
}

it("registers code before publication and honors explicit/default optimization",()=>{
  const {v,meter,programs,policy,request}=fixture(),context=createRuntimeCompilation(v,programs,policy);
  context.compile(request,undefined,meter);
  const optimized=policy.code.mock.calls[0][0];
  expect(optimized.docstring).toBeUndefined();
  context.compile({...request,optimize:0},undefined,meter);
  const unoptimized=policy.code.mock.calls[1][0];
  expect(unoptimized.docstring?.value).toEqual(v.string("doc"));
  expect(programs.lookup(optimized)).not.toBe(programs.lookup(unoptimized));
});

it("preserves future flags without consulting caller inheritance twice",()=>{
  const {v,meter,programs,policy,request}=fixture(),inheritedFlags=vi.fn(()=>0x1000000),context=createRuntimeCompilation(v,programs,{...policy,inheritedFlags});
  expect(context.compile({...request,flags:0x1000000},undefined,meter)).toEqual(v.integer(0x1000000));
  expect(inheritedFlags).not.toHaveBeenCalled();
});

it.each(["single","func_type", "ast"] as const)("routes extended compilation intact without text admission: %s",kind=>{
  const {v,meter,programs,policy,request}=fixture(),source=v.cell({}),compileExtended=vi.fn(()=>source),context=createRuntimeCompilation(v,programs,{...policy,compileExtended});
  const extended={...request,source,mode:kind==="ast"?"exec" as const:kind,flags:kind==="single"?0:0x400};
  expect(context.compile(extended,undefined,meter)).toBe(source);
  expect(compileExtended).toHaveBeenCalledWith(extended,undefined,meter);expect(policy.compilation).not.toHaveBeenCalled();expect(policy.code).not.toHaveBeenCalled();
});

it("does not silently ignore unsupported compiler flags",()=>{
  const {v,meter,programs,policy,request}=fixture(),context=createRuntimeCompilation(v,programs,policy);
  expect(()=>context.compile({...request,flags:0x2000},undefined,meter)).toThrow("requires an extended backend");
  expect(policy.compilation).not.toHaveBeenCalled();expect(policy.code).not.toHaveBeenCalled();
});

it.each([false,true])("preserves cancellation from code publication (throws=%s)",throws=>{
  const {v,meter,programs,policy,request,controller}=fixture(),context=createRuntimeCompilation(v,programs,{...policy,code(){controller.abort();if(throws)throw Error("publisher failed");return v.none;}});
  expect(()=>context.compile(request,undefined,meter)).toThrow(ExecutionLimitError);
});

it.each([false,true])("preserves cancellation from an extended compiler (throws=%s)",throws=>{
  const {v,meter,programs,policy,request,controller}=fixture(),context=createRuntimeCompilation(v,programs,{...policy,compileExtended(){controller.abort();if(throws)throw Error("extension failed");return v.none;}});
  expect(()=>context.compile({...request,mode:"single"},undefined,meter)).toThrow(ExecutionLimitError);
  expect(policy.compilation).not.toHaveBeenCalled();expect(policy.code).not.toHaveBeenCalled();
});

it("rejects invalid sources before consulting compilation policy",()=>{
  const {v,meter,programs,policy,request}=fixture(),context=createRuntimeCompilation(v,programs,policy);
  expect(()=>context.compile({...request,source:v.integer(1)},undefined,meter)).toThrow("compile() arg 1");
  expect(policy.compilation).not.toHaveBeenCalled();expect(policy.code).not.toHaveBeenCalled();
});

it("uses explicit filesystem decoding while preserving string filename identity",()=>{
  const {v,meter,programs,policy}=fixture(),decodeFilename=vi.fn(()=>new CodePointString(new Uint32Array([255]),meter)),context=createRuntimeCompilation(v,programs,{...policy,decodeFilename});
  const name=v.stringPoints(new Uint32Array([0xd800,0xdc00]));
  expect(context.filename(name,undefined,meter)).toEqual({displayName:"\ud800\udc00",value:name});expect(decodeFilename).not.toHaveBeenCalled();
  const bytes=v.bytes(new Uint8Array([255]));
  expect(context.filename(bytes,undefined,meter)).toEqual({displayName:"ÿ",value:v.string("ÿ")});expect(decodeFilename).toHaveBeenCalledWith(bytes.value,meter);
});
