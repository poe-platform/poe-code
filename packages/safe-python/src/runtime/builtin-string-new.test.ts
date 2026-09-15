import {expect,it,vi} from "vitest";
import {createStringNewBuiltin} from "./builtin-string-new.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeTypeLayout} from "./runtime-type-layout.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {createRuntimeRepresentationContext} from "./runtime-representation.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:2000000}),v=new RuntimeValues(meter);
  const keys={hash:()=>1n,equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,v,meter).value},registry=new RuntimeTypeRegistry(v,keys,meter);
  const dictionary=()=>v.dictionary(registry.object.value.namespace.items.emptyCopy());
  const owner=registry.publish(new RuntimeTypeLayout("str",[registry.object.value],dictionary(),meter,{objectLayout:false,instanceDictionary:false,weakReferences:false}),registry.type);
  const subclass=registry.publish(new RuntimeTypeLayout("S",[owner.value],dictionary(),meter),registry.type);
  const decode=vi.fn(()=>v.string("decoded")),owns=vi.fn(()=>true),builtin=createStringNewBuiltin(owner,v,meter,owns,decode),keywords=dictionary();
  const call=(args:RuntimeValue[],invocation?:BuiltinInvocationContext)=>builtin.value.invoke(args,keywords,meter,invocation);
  return {meter,v,registry,owner,subclass,decode,owns,builtin,keywords,call,dictionary};
}
it("preserves exact string identity and allocates independent subtype instances",()=>{
  const {v,owner,subclass,call}=fixture(),source=v.string("🐍"),first=call([subclass,source]),second=call([subclass,source]);
  expect(call([owner,source])).toBe(source);expect(first.kind).toBe("instance");expect(first).not.toBe(second);
  if(first.kind!=="instance"||second.kind!=="instance")throw Error("expected instances");
  expect(first.type).toBe(subclass);expect(first.native?.kind).toBe("str");expect(first.native).toEqual(source);
  expect(first.dictionary).toBeDefined();expect(first.dictionary).not.toBe(second.dictionary);
});
it("validates receiver admission before string arguments and decoder calls",()=>{
  const {v,owner,registry,call,decode}=fixture();
  expect(()=>call([])).toThrow("str.__new__(): not enough arguments");
  expect(()=>call([v.integer(1)])).toThrow("str.__new__(X): X is not a type object (int)");
  expect(()=>call([registry.object])).toThrow("str.__new__(object): object is not a subtype of str");
  expect(()=>call([owner,v.none,v.none,v.none,v.none])).toThrow("str() takes at most 3 arguments (4 given)");
  expect(decode).not.toHaveBeenCalled();
});
it("respects dictionary-free string subtype layouts with native slots",()=>{
  const {v,meter,owner,registry,dictionary,call}=fixture();
  const subtype=registry.publish(new RuntimeTypeLayout("Slotted",[owner.value],dictionary(),meter,{instanceDictionary:false,slots:["tag"]}),registry.type);
  const result=call([subtype,v.string("x")]);
  if(result.kind!=="instance")throw Error("expected subtype");
  expect(result.dictionary).toBeUndefined();expect(result.type.value.slotCount).toBe(1);expect(result.native).toEqual(v.string("x"));
});
it("rejects decoding native string subtype instances before codec lookup",()=>{
  const {v,owner,subclass,call,decode}=fixture(),source=v.instance(subclass,undefined,v.string("x"));
  expect(()=>call([owner,source,v.string("unknown")])).toThrow("decoding str is not supported");expect(decode).not.toHaveBeenCalled();
});
it("rejects unknown keywords even when a subtype defines an initializer",()=>{
  const {v,subclass,keywords,call}=fixture();subclass.value.namespace.items.set(v.string("__init__"),v.none);keywords.items.set(v.string("foo"),v.none);
  expect(()=>call([subclass,v.string("x")])).toThrow("str() got an unexpected keyword argument 'foo'");
});
it("uses direct-new argument diagnostics rather than the exact-type call fast path",()=>{
  const {v,owner,subclass,call}=fixture();
  for(const type of [owner,subclass])expect(()=>call([type,v.string("x"),v.none])).toThrow(/^str\(\) argument 'encoding' must be str, not None$/);
});
it.each([false,true])("decodes before wrapping subtype storage without invoking initializers (explicit errors=%s)",explicitErrors=>{
  const {v,subclass,call,decode}=fixture(),source=v.bytes(new Uint8Array([120])),result=call([subclass,source,v.string("custom"),...(explicitErrors?[v.string("strict")]:[])]);
  expect(result.kind).toBe("instance");if(result.kind!=="instance")throw Error("expected subtype");
  expect(result.native).toEqual(v.string("decoded"));expect(decode).toHaveBeenCalledWith(source,"custom",explicitErrors?"strict":undefined,expect.anything(),undefined);
  expect(decode).toHaveBeenCalledTimes(1);
});
it("recognizes native string subtype storage without consulting guest conversion",()=>{
  const {v,meter,subclass}=fixture(),source=v.instance(subclass,undefined,v.string("stored")),string=vi.fn();
  const context=createRuntimeRepresentationContext(v,meter,{string,defaultRepr:()=>v.none});
  expect(context.string(source)).toBe(source.native?.kind==="str"?source.native.value:undefined);
  expect(context.isExactString(source)).toBe(false);expect(string).not.toHaveBeenCalled();
});
it("retains conversion-result subclass identity for exact str but rewraps subtype allocations",()=>{
  const {v,meter,owner,subclass,call}=fixture(),source=v.cell({}),returned=v.instance(subclass,undefined,v.string("override"));
  const formatting=createRuntimeRepresentationContext(v,meter,{lookupStr:()=>()=>returned,defaultRepr:()=>v.none});
  const invocation={call:vi.fn(),formatting:{...formatting,isExactInteger:()=>false,lookupFormat:()=>undefined}};
  expect(call([owner,source],invocation)).toBe(returned);
  const result=call([subclass,source],invocation);expect(result).not.toBe(returned);
  if(result.kind!=="instance")throw Error("expected subtype");expect(result.native).toEqual(v.string("override"));
});
it("rejects foreign allocators and incompatible native layouts",()=>{
  const {meter,owner,registry,dictionary,call,owns}=fixture();
  const unsafe=registry.publish(new RuntimeTypeLayout("Unsafe",[owner.value],dictionary(),meter,{objectLayout:false}),registry.type);
  expect(()=>call([unsafe])).toThrow("str.__new__(Unsafe) is not safe, use Unsafe.__new__()");
  owns.mockReturnValue(false);expect(()=>call([owner])).toThrow("type is not owned by this string allocator");
});
it.each([false,true])("preserves cancellation from allocator ownership checks (throws=%s)",throws=>{
  const {v,owner,keywords,decode}=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100000,signal:controller.signal});
  const builtin=createStringNewBuiltin(owner,v,meter,()=>{controller.abort();if(throws)throw Error("ownership failed");return true;},decode);
  expect(()=>builtin.value.invoke([owner],keywords,meter)).toThrow(ExecutionLimitError);
});
