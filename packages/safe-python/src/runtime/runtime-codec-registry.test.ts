import {expect,it} from "vitest";
import {PythonRuntimeError} from "./error.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues,type RuntimeValue,type BuiltinInvocationContext} from "./runtime-values.js";

function fixture(signal?:AbortSignal){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal}),v=new RuntimeValues(meter);
  const callbacks=new Map<RuntimeValue,(args:readonly RuntimeValue[])=>RuntimeValue>();
  const context:BuiltinInvocationContext={call:(fn,args)=>callbacks.get(fn)!(args),isCallable:fn=>callbacks.has(fn),isStopIteration:()=>false};
  const fn=(callback:(args:readonly RuntimeValue[])=>RuntimeValue)=>{const value=v.builtinFunction({name:"search",invoke:()=>v.none});callbacks.set(value,callback);return value;};
  const registry=new RuntimeCodecRegistry(v,meter),codec=v.tuple([v.none,v.none,v.none,v.none]);
  return {meter,v,context,fn,registry,codec};
}
it("normalizes names, caches successful identity, and isolates registries",()=>{
  const {v,meter,context,fn,registry,codec}=fixture(),seen:RuntimeValue[]=[];
  registry.register(fn(args=>{seen.push(args[0]);return codec;}),context);
  expect(registry.lookup(" ÉX---Y. ",context)).toBe(codec);
  expect(registry.lookup("x_y.",context)).toBe(codec);
  expect(seen).toEqual([v.string("x_y.")]);
  expect(()=>new RuntimeCodecRegistry(v,meter).lookup("x_y.",context)).toThrow("no codec search functions registered");
});
it("retries failed initialization before returning an exact cached name",()=>{
  const {v,meter,context,fn,codec}=fixture();
  const replacement=v.tuple([v.integer(1),v.none,v.none,v.none]);
  const first=fn(()=>codec),second=fn(()=>replacement);
  let attempts=0;
  const registry=new RuntimeCodecRegistry(v,meter,()=>{
    attempts++;
    if(attempts===1){
      registry.register(first,context);
      expect(registry.lookup("cached",context)).toBe(codec);
      throw new PythonRuntimeError("ValueError","initialization failed");
    }
    registry.unregister(first);
    registry.register(second,context);
  });
  expect(()=>registry.lookup("cached",context)).toThrow("initialization failed");
  expect(registry.lookup("cached",context)).toBe(replacement);
  expect(attempts).toBe(2);
});
it.each(["cached\0", "cached\ud800", "cached\0\ud800", "💥\ud800\ud801z"])("validates original spelling before using normalized cache: %s",name=>{
  const {registry,fn,context,codec}=fixture();
  let calls=0;
  registry.register(fn(()=>{calls++;return codec;}),context);
  registry.lookup("cached",context);
  expect(()=>registry.lookup(name,context)).toThrow(name.includes("\ud800")?"surrogates not allowed":"embedded null character");
  expect(calls).toBe(1);
});
it("registration preserves cache; unregister removes only the first identity and clears hits only when found",()=>{
  const {registry,fn,context,codec,v}=fixture();let calls=0;
  const search=fn(()=>{calls++;return codec;});registry.register(search,context);registry.register(search,context);
  registry.lookup("x",context);registry.register(fn(()=>v.none),context);registry.unregister(v.none);
  registry.lookup("x",context);expect(calls).toBe(1);
  registry.unregister(search);registry.lookup("x",context);expect(calls).toBe(2);
  registry.unregister(search);expect(()=>registry.lookup("x",context)).toThrow("unknown encoding: x");
});
it("does not cache misses or guest failures",()=>{
  const {registry,fn,context,codec,v}=fixture();let calls=0;
  registry.register(fn(()=>{calls++;if(calls===1)throw new Error("guest failure");return calls===2?v.none:codec;}),context);
  expect(()=>registry.lookup("x",context)).toThrow("guest failure");
  expect(()=>registry.lookup("x",context)).toThrow("unknown encoding: x");
  expect(registry.lookup("x",context)).toBe(codec);expect(calls).toBe(3);
});
it("retains normalized search-name identity across misses, failures and cache invalidation",()=>{
  const {registry,fn,context,codec,v}=fixture(),seen:RuntimeValue[]=[];
  let mode:"miss"|"failure"|"success"="miss";
  const search=fn(args=>{
    seen.push(args[0]);
    if(mode==="failure")throw new PythonRuntimeError("ValueError","search failed");
    return mode==="success"?codec:v.none;
  });
  registry.register(search,context);
  expect(()=>registry.lookup("Codec-Identity-Probe",context)).toThrow("unknown encoding");
  mode="failure";
  expect(()=>registry.lookup("CODEC IDENTITY PROBE",context)).toThrow("search failed");
  mode="success";
  expect(registry.lookup("codec_identity_probe",context)).toBe(codec);
  registry.unregister(search);
  registry.register(search,context);
  expect(registry.lookup("codec-identity-probe",context)).toBe(codec);
  expect(seen).toHaveLength(4);
  for(const name of seen)expect(name).toBe(seen[0]);
});
it.each([0,3,5])("rejects search tuples with %i elements",length=>{
  const {registry,fn,context,v}=fixture();registry.register(fn(()=>v.tuple(Array.from({length},()=>v.none))),context);
  expect(()=>registry.lookup("x",context)).toThrow("codec search functions must return 4-tuples");
});
it("rejects lists and noncallables without invoking guest equality",()=>{
  const {registry,fn,context,v}=fixture();expect(()=>registry.register(v.none,context)).toThrow("argument must be callable");
  registry.register(fn(()=>v.list([v.none,v.none,v.none,v.none])),context);
  expect(()=>registry.lookup("x",context)).toThrow("codec search functions must return 4-tuples");
});
it("uses a fixed initial search length but live entries during mutation",()=>{
  const {registry,fn,context,v,codec}=fixture();
  const second=fn(()=>codec);const first=fn(()=>{registry.register(second,context);return v.none;});
  registry.register(first,context);expect(()=>registry.lookup("x",context)).toThrow("unknown encoding: x");
  expect(registry.lookup("x",context)).toBe(codec);
});
it("validates NUL and surrogate encoding names before searching",()=>{
  const {registry,fn,context,codec}=fixture();let calls=0;registry.register(fn(()=>{calls++;return codec;}),context);
  expect(()=>registry.lookup("x\0",context)).toThrow("embedded null character");
  expect(()=>registry.lookup("\ud800",context)).toThrow("surrogates not allowed");expect(calls).toBe(0);
});
it("keeps error handlers case sensitive, replaceable and separate from codec cache",()=>{
  const {registry,fn,context,v}=fixture(),a=fn(()=>v.none),b=fn(()=>v.none);
  registry.registerError("Case",a,context);expect(registry.lookupError("Case")).toBe(a);
  expect(()=>registry.lookupError("case")).toThrow("unknown error handler name 'case'");
  registry.registerError("Case",b,context);expect(registry.lookupError("Case")).toBe(b);
  expect(()=>registry.registerError("Case",v.none,context)).toThrow("handler must be callable");
});
it.each([
  ["x".repeat(401),"x".repeat(400)],
  ["é".repeat(201),"é".repeat(200)],
  ["a".repeat(399)+"€","a".repeat(399)],
  ["a".repeat(398)+"€","a".repeat(398)],
  ["a".repeat(397)+"€x","a".repeat(397)+"€"],
  ["a".repeat(399)+"💥","a".repeat(399)],
  ["a".repeat(397)+"💥","a".repeat(397)],
  ["a".repeat(396)+"💥x","a".repeat(396)+"💥"]
])("bounds missing-handler diagnostics by UTF-8 bytes without truncating registration keys (case %#)",(name,diagnostic)=>{
  const {registry,fn,context,v}=fixture(),handler=fn(()=>v.none);
  expect(()=>registry.lookupError(name)).toThrow(new PythonRuntimeError("LookupError",`unknown error handler name '${diagnostic}'`));
  registry.registerError(name,handler,context);
  expect(registry.lookupError(name)).toBe(handler);
  expect(()=>registry.lookupError(diagnostic)).toThrow(new PythonRuntimeError("LookupError",`unknown error handler name '${diagnostic}'`));
});
it.each([false,true])("cancellation dominates search return or failure (throws=%s)",throws=>{
  const controller=new AbortController(),{registry,fn,context,codec}=fixture(controller.signal);
  registry.register(fn(()=>{controller.abort();if(throws)throw Error("guest failure");return codec;}),context);
  expect(()=>registry.lookup("x",context)).toThrow(ExecutionLimitError);
});
it.each(["x\0y","\ud800"])("validates error handler names at the C-string boundary: %s",name=>{
  const {registry,fn,context,v}=fixture();
  expect(()=>registry.registerError(name,fn(()=>v.none),context)).toThrow();
  expect(()=>registry.lookupError(name)).toThrow(name.includes("\0")?"embedded null character":"surrogates not allowed");
});
it.each([-4n,4n])("checks adjusted negative and positive resume bounds: %s",position=>{
  const {registry,fn,context,v}=fixture();registry.registerError("custom",fn(()=>v.tuple([v.string("?"),v.integer(position)])),context);
  expect(()=>registry.handleError("custom",v.none,"decode",3,context)).toThrow(`position ${position<0n?position+3n:position} from error handler out of bounds`);
});
it.each([-1n,1n])("returns validated replacement identity and resume position: %s",position=>{
  const {registry,fn,context,v}=fixture(),replacement=v.string("?"),error=v.string("exception token");
  registry.registerError("custom",fn(args=>{expect(args).toEqual([error]);return v.tuple([replacement,v.integer(position)]);}),context);
  expect(registry.handleError("custom",error,"decode",3,context)).toEqual({replacement,position:Number(position<0n?position+3n:position)});
});
it("permits bytes only for encoding replacements and validates tuple shape before position",()=>{
  const {registry,fn,context,v}=fixture(),replacement=v.bytes(new Uint8Array([255]));
  registry.registerError("custom",fn(()=>v.tuple([replacement,v.integer(1)])),context);
  expect(registry.handleError("custom",v.none,"encode",3,context)).toEqual({replacement,position:1});
  expect(()=>registry.handleError("custom",v.none,"decode",3,context)).toThrow("decoding error handler must return (str, int) tuple");
  registry.registerError("custom",fn(()=>v.list([v.string(""),v.integer(1)])),context);
  expect(()=>registry.handleError("custom",v.none,"encode",3,context)).toThrow("encoding error handler must return (str/bytes, int) tuple");
  registry.registerError("custom",fn(()=>v.tuple([v.string(""),v.float(1)])),context);
  expect(()=>registry.handleError("custom",v.none,"decode",3,context)).toThrow("'float' object cannot be interpreted as an integer");
});
it.each([false,true])("cancellation dominates custom error handlers (throws=%s)",throws=>{
  const controller=new AbortController(),{registry,fn,context,v}=fixture(controller.signal);
  registry.registerError("custom",fn(()=>{controller.abort();if(throws)throw Error("guest failure");return v.tuple([v.string(""),v.integer(1)]);}),context);
  expect(()=>registry.handleError("custom",v.none,"decode",3,context)).toThrow(ExecutionLimitError);
});
it.each(["encode","decode"] as const)("does not reenter a retained %s error handler after termination",operation=>{
  const controller=new AbortController(),{registry,fn,context,v}=fixture(controller.signal);
  const result=v.tuple([v.string(""),v.integer(1)]);
  let calls=0;
  const handler=fn(()=>{calls++;controller.abort();return result;});
  let terminal:unknown;
  try {registry.handleError(handler,v.none,operation,3,context);}catch(error){terminal=error;}
  expect(terminal).toBeInstanceOf(ExecutionLimitError);
  expect(calls).toBe(1);
  for(let attempt=0;attempt<2;attempt++){
    try {registry.handleError(handler,v.none,operation,3,context);expect.fail("terminated recovery returned");}
    catch(error){expect(error).toBe(terminal);}
    expect(calls).toBe(1);
  }
});
it.each(["encode","decode"] as const)("checks cancellation before invoking a retained %s error handler",operation=>{
  const controller=new AbortController(),{registry,fn,context,v}=fixture(controller.signal);
  let calls=0;
  const handler=fn(()=>{calls++;throw new PythonRuntimeError("ValueError","unexpected callback");});
  controller.abort();
  expect(()=>registry.handleError(handler,v.none,operation,3,context)).toThrow(ExecutionLimitError);
  expect(calls).toBe(0);
});
it("detects search-path shrinkage during lookup without taking a snapshot",()=>{
  const {registry,fn,context,v}=fixture();const second=fn(()=>v.none);
  registry.register(fn(()=>{registry.unregister(second);return v.none;}),context);registry.register(second,context);
  expect(()=>registry.lookup("x",context)).toThrow("list index out of range");
});
it.each([1n<<63n,-(1n<<63n)-1n])("rejects resume positions outside pinned Py_ssize_t: %s",position=>{
  const {registry,fn,context,v}=fixture();registry.registerError("custom",fn(()=>v.tuple([v.string(""),v.integer(position)])),context);
  expect(()=>registry.handleError("custom",v.none,"decode",3,context)).toThrow("Python int too large to convert to C ssize_t");
});
it("accepts boolean positions and invokes __index__ through the explicit protocol",()=>{
  const {registry,fn,context,v}=fixture();let indexes=0;const position=v.cell({});
  const indexed={...context,integerIndex:{integer:(value:RuntimeValue)=>value.kind==="int"?value.value:undefined,isExactInteger:(value:RuntimeValue)=>value.kind==="int",lookupIndex:(value:RuntimeValue)=>value===position?()=>{indexes++;return v.integer(-1);}:undefined,typeName:()=>"position",warn:()=>{throw Error("unexpected warning");}}};
  registry.registerError("custom",fn(()=>v.tuple([v.string(""),position])),context);
  expect(registry.handleError("custom",v.none,"decode",3,indexed).position).toBe(2);expect(indexes).toBe(1);
  registry.registerError("custom",fn(()=>v.tuple([v.string(""),v.true])),context);
  expect(registry.handleError("custom",v.none,"decode",3,context).position).toBe(1);
});
