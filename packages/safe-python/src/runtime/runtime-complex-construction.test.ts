import { expect,it } from "vitest";
import { ExecutionBudget,ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues,type RuntimeValue,type BuiltinInvocationContext } from "./runtime-values.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { constructRuntimeComplex } from "./runtime-complex-construction.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";

function fixture() {
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter);
  const keywords=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>1n,equal:(a,b)=>a===b},meter));
  return {v,meter,keywords,call:(args:RuntimeValue[],invocation?:BuiltinInvocationContext)=>constructRuntimeComplex(args,keywords,v,meter,invocation)};
}

it("constructs native complex values and preserves exact single-argument identity",()=>{
  const {v,call}=fixture(),z=v.complex(-0,-0);
  expect(call([])).toEqual(v.complex(0,0));expect(call([z])).toBe(z);
  expect(call([v.string(" (1+2j) ")])).toEqual(v.complex(1,2));
  expect(call([v.integer(3),v.float(-0)])).toEqual(v.complex(3,-0));
  expect(call([v.complex(1,2),v.complex(3,4)])).toEqual(v.complex(-3,5));
});

it("distinguishes positional single-argument parsing from real/imag keyword construction",()=>{
  const {v,keywords,call}=fixture();keywords.items.set(v.string("real"),v.string("1"));
  expect(()=>call([])).toThrow("complex() argument 'real' must be a real number, not str");
  expect(()=>call([v.integer(1)])).toThrow("argument for complex() given by name ('real') and position (1)");
  expect(()=>call([v.integer(1),v.integer(2)])).toThrow("complex() takes at most 2 arguments (3 given)");
});

it("converts __complex__ before float and validates unsupported imag before warning",()=>{
  const {v,call}=fixture(),real=v.list([]),imag=v.list([]),method=v.none,events:string[]=[];
  const invocation:BuiltinInvocationContext={isStopIteration:()=>false,
    lookupSpecial:(value,name)=>{events.push(value===real?`real:${name}`:`imag:${name}`);return value===real&&name==="__complex__"?method:undefined;},
    call:()=>{events.push("call");return v.complex(1,2);},
    typeName:value=>value===real?"Real":"Imag",warn:(_category,message)=>events.push(message)};
  expect(call([real],invocation)).toEqual(v.complex(1,2));events.length=0;
  expect(()=>call([real,imag],invocation)).toThrow("complex() argument 'imag' must be a real number, not Imag");
  expect(events).not.toContain("complex() argument 'real' must be a real number, not Real");
});

it("bypasses owned float overrides only in the single positional form",()=>{
  const {v,meter,keywords,call}=fixture(),owner=v.type(new RuntimeTypeLayout("F",[],keywords,meter,{objectLayout:false}),"self"),source=v.instance(owner,undefined,v.float(2));
  const invocation:BuiltinInvocationContext={isStopIteration:()=>false,lookupSpecial:(value,name)=>value===source&&name==="__float__"?v.none:undefined,call:()=>v.float(9)};
  expect(call([source],invocation)).toEqual(v.complex(2,0));
  expect(call([source,v.integer(1)],invocation)).toEqual(v.complex(9,1));
  expect(call([v.integer(1),source],invocation)).toEqual(v.complex(1,9));
});

it("preserves negative imaginary zero when real is passed by keyword",()=>{
  const {v,keywords,call}=fixture();keywords.items.set(v.string("real"),v.complex(-0,-0));
  expect(call([])).toEqual(v.complex(-0,-0));
});

it("keeps full complex constructor diagnostic type names",()=>{
  const {v,call}=fixture(),name="x".repeat(250);
  try{call([v.list([])],{isStopIteration:()=>false,call:()=>v.none,typeName:()=>name});throw Error("expected error");}
  catch(error){expect((error as Error).message).toBe(`complex() argument must be a string or a number, not ${name}`);}
});

it("limits __complex__ result diagnostic names to 200 UTF-8 bytes",()=>{
  const {v,call}=fixture(),source=v.list([]),name="x".repeat(250);
  try{call([source],{isStopIteration:()=>false,lookupSpecial:()=>v.none,call:()=>v.integer(1),typeName:()=>name});throw Error("expected error");}
  catch(error){expect((error as Error).message).toBe(`__complex__ returned non-complex (type ${"x".repeat(200)})`);}
});

it("copies owned complex storage and honors its conversion only for the real input",()=>{
  const {v,meter,keywords,call}=fixture(),owner=v.type(new RuntimeTypeLayout("Z",[],keywords,meter,{objectLayout:false}),"self"),source=v.instance(owner,undefined,v.complex(-0,-0));
  expect(call([source])).toEqual(v.complex(-0,-0));
  const invocation:BuiltinInvocationContext={isStopIteration:()=>false,typeName:()=>"Z",lookupSpecial:(value,name)=>value===source&&name==="__complex__"?v.none:undefined,call:()=>v.complex(7,8)};
  expect(call([source],invocation)).toEqual(v.complex(7,8));
  expect(call([v.integer(1),source],invocation)).toEqual(v.complex(1,-0));
});

it("normalizes strict complex protocol results with a warning and copies exact results",()=>{
  const {v,meter,keywords,call}=fixture(),owner=v.type(new RuntimeTypeLayout("Z",[],keywords,meter,{objectLayout:false}),"self"),source=v.list([]),exact=v.complex(1,2),owned=v.instance(owner,undefined,exact),warnings:string[]=[];
  const invocation:BuiltinInvocationContext={isStopIteration:()=>false,typeName:()=>"Z",lookupSpecial:()=>v.none,call:()=>owned,warn:(_category,message)=>warnings.push(message)};
  expect(call([source],invocation)).toEqual(exact);
  expect(warnings).toEqual(["__complex__ returned non-complex (type Z).  The ability to return an instance of a strict subclass of complex is deprecated, and may be removed in a future version of Python."]);
  expect(call([source],{...invocation,call:()=>exact})).not.toBe(exact);
});

it("stops immediately when complex deprecation warnings become errors",()=>{
  const {v,call}=fixture(),error=new Error("warning filter"),imag=v.list([]);let converted=false;
  const invocation:BuiltinInvocationContext={isStopIteration:()=>false,hasSpecial:(value,name)=>value===imag&&name==="__float__",lookupSpecial:(value,name)=>value===imag&&name==="__float__"?v.none:undefined,call:()=>{converted=true;return v.float(1);},warn:()=>{throw error;}};
  expect(()=>call([v.complex(1,2),imag],invocation)).toThrow(error);expect(converted).toBe(false);
});

it.each([false,true])("rechecks float conversion after a warning mutates the imaginary type (buffer %s)",buffer=>{
  const {v,call}=fixture(),imag=v.list([]);let enabled=true,released=false;
  const invocation:BuiltinInvocationContext={isStopIteration:()=>false,typeName:()=>"I",hasSpecial:(value,name)=>enabled&&value===imag&&name==="__float__",lookupSpecial:(value,name)=>enabled&&value===imag&&name==="__float__"?v.none:undefined,call:()=>v.float(2),warn:()=>{enabled=false;},
    buffers:buffer?{acquireSimple:()=>({byteLength:1,copy:()=>v.bytes([51]).value,release:()=>{released=true;}})}:undefined};
  if(buffer){expect(call([v.complex(0,1),imag],invocation)).toEqual(v.complex(0,4));expect(released).toBe(true);}
  else expect(()=>call([v.complex(0,1),imag],invocation)).toThrow("float() argument must be a string or a real number, not 'I'");
});

it("rejects non-complex protocol results and preserves host and fatal conversion failures",()=>{
  const {v,call}=fixture(),source=v.list([]);
  const invocation:BuiltinInvocationContext={isStopIteration:()=>false,lookupSpecial:()=>v.none,call:()=>v.integer(1)};
  expect(()=>call([source],invocation)).toThrow("__complex__ returned non-complex (type int)");
  for(const error of [new Error("host"),new ExecutionLimitError("cancelled")])expect(()=>call([source],{...invocation,call:()=>{throw error;}})).toThrow(error);
});

it("does not use __complex__ for the imaginary argument or accept bytes as text",()=>{
  const {v,call}=fixture(),names:string[]=[],imag=v.list([]);
  expect(()=>call([v.bytes([49])])).toThrow("complex() argument must be a string or a number, not bytes");
  expect(()=>call([v.integer(1),imag],{isStopIteration:()=>false,lookupSpecial:(value,name)=>{if(value===imag)names.push(name);return undefined;},call:()=>v.none})).toThrow("complex() argument 'imag' must be a real number, not list");
  expect(names).not.toContain("__complex__");
});
