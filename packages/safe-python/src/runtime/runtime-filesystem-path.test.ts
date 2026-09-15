import {expect,it,vi} from "vitest";
import {runtimeFileSystemPath,decodeRuntimeFileSystemName} from "./runtime-filesystem-path.js";
import {RuntimeValues,type BuiltinInvocationContext} from "./runtime-values.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {ImmutableBytes} from "./immutable-bytes.js";
import {CodePointString} from "./code-point-string.js";

function fixture(){const meter=new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:10000000});return {meter,v:new RuntimeValues(meter)};}
it("preserves str/bytes path identities without special-method lookup",()=>{
  const {v,meter}=fixture(),lookupSpecial=vi.fn(),invocation={lookupSpecial} as unknown as BuiltinInvocationContext;
  const text=v.string("../folder/🐍"),bytes={kind:"bytes",value:ImmutableBytes.copyOf([255,120],meter)} as const;
  expect(runtimeFileSystemPath(text,meter,invocation)).toBe(text);expect(runtimeFileSystemPath(bytes,meter,invocation)).toBe(bytes);expect(lookupSpecial).not.toHaveBeenCalled();
});
it("invokes the type-level path method once without recursive conversion",()=>{
  const {v,meter}=fixture(),path=v.cell({}),method=v.cell({}),result=v.string("../x"),call=vi.fn(()=>result),lookupSpecial=vi.fn(()=>method);
  expect(runtimeFileSystemPath(path,meter,{call,lookupSpecial,typeName:()=>"Path"} as unknown as BuiltinInvocationContext)).toBe(result);
  expect(lookupSpecial).toHaveBeenCalledWith(path,"__fspath__");expect(call).toHaveBeenCalledWith(method,[]);expect(call).toHaveBeenCalledTimes(1);
});
it.each(["none","int","cell"] as const)("rejects a missing path protocol: %s",kind=>{
  const {v,meter}=fixture(),value=kind==="none"?v.none:kind==="int"?v.integer(1):v.cell({});
  expect(()=>runtimeFileSystemPath(value,meter)).toThrow(`expected str, bytes or os.PathLike object, not ${kind==="none"?"NoneType":kind}`);
});
it("rejects non-path results without recursively invoking their methods",()=>{
  const {v,meter}=fixture(),path=v.cell({}),method=v.cell({}),result=v.integer(1),call=vi.fn(()=>result);
  expect(()=>runtimeFileSystemPath(path,meter,{lookupSpecial:()=>method,call,typeName:value=>value===path?"Path":"int"} as BuiltinInvocationContext)).toThrow("expected Path.__fspath__() to return str or bytes, not int");expect(call).toHaveBeenCalledTimes(1);
});
it("retains text code points including distinct surrogate pairs",()=>{
  const {v,meter}=fixture(),text=v.stringPoints(new Uint32Array([0xd800,0xdc00,0,47,46,46]));
  expect(decodeRuntimeFileSystemName(text,meter)).toBe(text.value);
  expect(Array.from(decodeRuntimeFileSystemName(text,meter))).toEqual([0xd800,0xdc00,0,47,46,46]);
});
it.each([
  {bytes:[255,120],points:[0xdcff,120]},
  {bytes:[0xf0,0x9f,0x90,0x8d],points:[0x1f40d]},
  {bytes:[0xed,0xa0,0x80],points:[0xdced,0xdca0,0xdc80]},
  {bytes:[0xc2],points:[0xdcc2]},
  {bytes:[0],points:[0]}
])("decodes filesystem bytes with surrogateescape: $bytes",({bytes,points})=>{
  const {meter}=fixture(),path={kind:"bytes",value:ImmutableBytes.copyOf(bytes,meter)} as const;
  expect(Array.from(decodeRuntimeFileSystemName(path,meter))).toEqual(points);
});
it("supports an explicit filesystem decoder without changing path ownership",()=>{
  const {meter}=fixture(),bytes=ImmutableBytes.copyOf([255],meter),path={kind:"bytes",value:bytes} as const,decoded=new CodePointString(new Uint32Array([255]),meter),decode=vi.fn(()=>decoded);
  expect(decodeRuntimeFileSystemName(path,meter,undefined,decode)).toBe(decoded);expect(decode).toHaveBeenCalledWith(bytes,meter);
});
it("preserves cancellation from a throwing path method",()=>{
  const {v}=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100000,signal:controller.signal});
  expect(()=>runtimeFileSystemPath(v.cell({}),meter,{lookupSpecial:()=>v.cell({}),call(){controller.abort();throw Error("path failure");}} as unknown as BuiltinInvocationContext)).toThrow(ExecutionLimitError);
});
it("charges byte decoding before allocating its output",()=>{
  const {meter}=fixture(),path={kind:"bytes",value:ImmutableBytes.copyOf([120],meter)} as const;
  expect(()=>decodeRuntimeFileSystemName(path,new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:0}))).toThrow(ExecutionLimitError);
});
