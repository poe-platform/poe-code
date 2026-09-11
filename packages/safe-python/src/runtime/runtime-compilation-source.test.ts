import {expect,it,vi} from "vitest";
import {runtimeCompilationSource} from "./runtime-compilation-source.js";
import {RuntimeValues} from "./runtime-values.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";

function fixture(){const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});return{meter,v:new RuntimeValues(meter)};}
it("prepares encoding errors with the original guest source object",()=>{
  const {v,meter}=fixture(),source=v.stringPoints(new Uint32Array([0xd800,0xdc00])),carrier=new Error("prepared"),prepareException=vi.fn(()=>carrier);
  expect(()=>runtimeCompilationSource(source,meter,{prepareException})).toThrow(carrier);
  expect(prepareException).toHaveBeenCalledWith(expect.objectContaining({name:"UnicodeEncodeError",object:source.value}),{unicodeObject:source});
});
it("preserves cancellation during encoding error preparation",()=>{
  const {v}=fixture(),source=v.string("\ud800"),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  expect(()=>runtimeCompilationSource(source,meter,{prepareException(){controller.abort();throw Error("preparation failed");}})).toThrow(ExecutionLimitError);
});
it("preserves the distinction between guest strings and bytes",()=>{
  const {v,meter}=fixture(),buffers={acquireSimple:vi.fn()};
  expect(runtimeCompilationSource(v.string('"🐍"'),meter,{buffers})).toBe('"🐍"');
  expect(runtimeCompilationSource(v.bytes(new Uint8Array([112,97,115,115])),meter,{buffers})).toEqual(new Uint8Array([112,97,115,115]));
  expect(buffers.acquireSimple).not.toHaveBeenCalled();
});
it.each([[0xd800],[0xd800,0xdc00],[65,0xdfff,0xd800,66],[0,0xd800]].map(points=>({points})))("rejects raw guest surrogates before a UTF-16 conversion: %j",({points})=>{
  const {v,meter}=fixture(),source=v.stringPoints(new Uint32Array(points));
  expect(()=>runtimeCompilationSource(source,meter)).toThrow(expect.objectContaining({name:"UnicodeEncodeError",object:source.value,start:points[0]<0xd800?1:0,end:points.at(-1)===66?3:points.length,reason:"surrogates not allowed"}));
});
it("copies and releases an acquired buffer exactly once",()=>{
  const {v,meter}=fixture(),source=v.cell({}),copy=vi.fn(()=>v.bytes(new Uint8Array([112,97,115,115])).value),release=vi.fn(),acquireSimple=vi.fn(()=>({byteLength:4,copy,release}));
  expect(runtimeCompilationSource(source,meter,{buffers:{acquireSimple}})).toEqual(new Uint8Array([112,97,115,115]));
  expect(acquireSimple).toHaveBeenCalledWith(source);expect(copy).toHaveBeenCalledTimes(1);expect(release).toHaveBeenCalledTimes(1);
});
it.each(["BufferError","ValueError","KeyboardInterrupt"])("rewrites guest %s acquisition failures",name=>{
  const {v,meter}=fixture();
  expect(()=>runtimeCompilationSource(v.none,meter,{buffers:{acquireSimple(){throw new PythonRuntimeError(name,"export failed");}}})).toThrow("compile() arg 1 must be a string, bytes or AST object");
});
it("does not hide host acquisition bugs or copy failures",()=>{
  const {v,meter}=fixture(),failure=new Error("host bug"),release=vi.fn();
  expect(()=>runtimeCompilationSource(v.none,meter,{buffers:{acquireSimple(){throw failure;}}})).toThrow(failure);
  expect(()=>runtimeCompilationSource(v.none,meter,{buffers:{acquireSimple(){return{byteLength:1,copy(){throw failure;},release};}}})).toThrow(failure);
  expect(release).toHaveBeenCalledTimes(1);
});
it("releases an acquired buffer even when acquisition cancels execution",()=>{
  const {v}=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}),copy=vi.fn(),release=vi.fn();
  expect(()=>runtimeCompilationSource(v.none,meter,{buffers:{acquireSimple(){controller.abort();return{byteLength:0,copy,release};}}})).toThrow(ExecutionLimitError);
  expect(copy).not.toHaveBeenCalled();expect(release).toHaveBeenCalledTimes(1);
});
