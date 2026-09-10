import { expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue, type TypeValue } from "./runtime-values.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { compileProgram } from "./program-compilation.js";
import { executeRuntimeProgram, type RuntimeProgramHooks } from "./runtime-program.js";
import { CallStack } from "./call-stack.js";
import { PythonRuntimeError } from "./error.js";
import { createBuildClassBuiltin } from "./builtin-build-class.js";
import { createCallableBuiltin } from "./builtin-callable.js";
import { PythonKeyError } from "./runtime-dictionary-access.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";
import { createDictionaryFromKeysBuiltin } from "./builtin-dictionary-fromkeys.js";
import { constructRuntimeSet } from "./runtime-set.js";
import { constructRuntimeFrozenSet } from "./runtime-frozenset.js";
import { createHashBuiltin } from "./builtin-hash.js";
import { createRuntimeKeyOperations } from "./runtime-key-operations.js";
import { RuntimeExecutionKeys } from "./runtime-execution-keys.js";
import { createIdBuiltin, type IdentityContext } from "./builtin-id.js";
import { createReversedBuiltin } from "./builtin-reversed.js";
import { constructRuntimeInteger } from "./runtime-integer-construction.js";
import { constructRuntimeFloat } from "./runtime-float-construction.js";
import { createRoundBuiltin } from "./builtin-round.js";
import { createRuntimeFormatContext } from "./runtime-format.js";
import { NumericLocale } from "./numeric-locale.js";
import { createExceptionAddNoteDescriptor } from "./builtin-exception-add-note.js";

// Deliberately colliding hash policies make native namespace lookup unusually
// expensive as catalogs grow; these integration tests are not step-limit tests.
function fixture(identity?: IdentityContext, maxSteps = 1000000, extensions: Partial<ReturnType<RuntimeProgramHooks["expressions"]>> = {}) {
  const meter = new ExecutionBudget({ maxSteps, maxAllocatedBytes: 2000000 }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const calls = new CallStack<object>(50, meter), keys = new RuntimeExecutionKeys(v, hash, meter, calls);
  const registry = new RuntimeTypeRegistry(v, keys, meter), native = new Map<string, TypeValue>();
  const globals = new Map<string, RuntimeValue>([["type", registry.type], ["object", registry.object], ["__name__", v.string("example")]]), events: string[] = [];
  const builtins = new Map<string, RuntimeValue>([["visit", v.builtinFunction({ name: "visit", invoke(args) { const value = args[0]; if (value.kind !== "str") throw Error("expected string"); events.push(String.fromCodePoint(...value.value)); return v.none; } })]]);
  builtins.set("__build_class__", createBuildClassBuiltin({ registry, keys }, v, meter));
  builtins.set("callable", createCallableBuiltin(v, meter));
  const unused = (): never => { throw Error("unexpected extension operation"); };
  const hooks: RuntimeProgramHooks = {
    expressions: () => ({ ...extensions, warn: unused }), statements: () => ({ setAttribute: unused, deleteAttribute: unused, executeUnhandled: unused }),
    callable: () => false, name: () => "guest()", keywordName: key => { if (key.kind !== "str") throw Error("expected string keyword"); return String.fromCodePoint(...key.value); }, invoke: unused,
    specialMethods: () => ({ slots: () => undefined, typeOf(value) {
      if (value.kind === "list") return registry.listType();
      if (value.kind === "tuple") return registry.tupleType();
      if (value.kind === "dict") return registry.dictionaryType();
      if (value.kind === "dict_keys" || value.kind === "dict_values" || value.kind === "dict_items") return registry.dictionaryViewType(value.kind);
      if (value.kind === "mappingproxy") return registry.mappingProxyType();
      if (value.kind === "slice") return registry.sliceType();
      if (value.kind === "range") return registry.rangeType();
      if (value.kind === "int") return registry.integerType();
      if (value.kind === "float") return registry.floatType();
      if (value.kind === "complex") return registry.complexType();
      if (value.kind === "bool") return registry.booleanType();
      if (value.kind === "set" || value.kind === "frozenset") return registry.setType(value.kind);
      if (value.kind === "method" || value.kind === "method-wrapper" || value.kind === "builtin_function_or_method") return registry.boundCallableType(value.kind);
      if (value.kind === "function" || value.kind === "method_descriptor" || value.kind === "classmethod_descriptor" || value.kind === "wrapper_descriptor" || value.kind === "getset_descriptor" || value.kind === "member_descriptor") return registry.descriptorType(value.kind);
      const existing = native.get(value.kind); if (existing !== undefined) return existing;
      const type = registry.publish(new RuntimeTypeLayout(value.kind === "none" ? "NoneType" : value.kind, [registry.object.value], v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), meter, { objectLayout: false, instanceDictionary: false }), registry.type);
      native.set(value.kind, type); return type;
    } })
  };
  function run(source: string) {
    executeRuntimeProgram(compileProgram<RuntimeValue>(analyzeModule(source), { stripDocstring: false }, v, meter), { values: v, globals, builtins, keys, hooks, calls, identity }, meter);
  }
  return { v, meter, hash, keys, registry, globals, builtins, events, calls, run };
}

it("reduces exceptions without materializing untouched dictionaries",()=>{
  const state=fixture();state.globals.set("BaseException",state.registry.baseExceptionType());
  state.run("e=BaseException(1,'two')\ninitial=e.__reduce__()\nempty=e.__dict__\nexposed=e.__reduce__()\ne.add_note('note')\nnoted=e.__reduce__()\ncorrect=initial==(BaseException,(1,'two')) and exposed==(BaseException,(1,'two'),{'__notes__':['note']}) and exposed[2] is empty and noted[2] is empty\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("leaves exception dictionaries lazy on failed reads but materializes failed deletions",()=>{
  const state=fixture();state.globals.set("BaseException",state.registry.baseExceptionType());state.run("e=BaseException()\n");
  expect(()=>state.run("e.missing\n")).toThrow("has no attribute 'missing'");
  state.run("unread=e.__reduce__()==(BaseException,())\ne.args=(1,)\nunchanged=e.__reduce__()==(BaseException,(1,))\n");
  expect(()=>state.run("del e.missing\n")).toThrow("has no attribute 'missing'");
  state.run("materialized=e.__reduce__()==(BaseException,(1,),{})\n");
  for(const key of ["unread","unchanged","materialized"])expect(state.globals.get(key)).toBe(state.v.true);
});

it("reduces native exception state without invoking attribute overrides",()=>{
  const state=fixture();state.globals.set("BaseException",state.registry.baseExceptionType());state.globals.set("Dict",state.registry.dictionaryType());
  state.run("class E(BaseException):\n def __getattribute__(self,name):\n  if name in ('__dict__','args','__class__'):\n   return 1/0\n  return object.__getattribute__(self,name)\nclass D(Dict):\n pass\ne=E(1)\nd=D(x=2)\ne.__dict__=d\nr=e.__reduce__()\ncorrect=r[0] is E and r[1]==(1,) and r[2] is d\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("exposes exception dictionaries and rejects deletion without detaching aliases",()=>{
  const state=fixture();state.globals.set("BaseException",state.registry.baseExceptionType());
  state.run("e=BaseException()\ne.tag=1\nold=e.__dict__\nreplacement={'tag':2}\ne.__dict__=replacement\ne.other=3\ncorrect=old=={'tag':1} and e.__dict__ is replacement and replacement=={'tag':2,'other':3}\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(()=>state.run("del e.__dict__\n")).toThrow("cannot delete __dict__");
  state.run("retained=e.__dict__ is replacement\n");expect(state.globals.get("retained")).toBe(state.v.true);
});

it("retains dictionary subclass identity while instance attributes bypass mapping overrides",()=>{
  const state=fixture();state.globals.set("BaseException",state.registry.baseExceptionType());state.globals.set("Dict",state.registry.dictionaryType());
  state.run("class D(Dict):\n def __getitem__(self,key):\n  return 1/0\n def __setitem__(self,key,value):\n  return 1/0\n def __delitem__(self,key):\n  return 1/0\nclass C:\n pass\nfor cls in (C,BaseException):\n obj=cls()\n d=D(tag=1)\n obj.__dict__=d\n obj.other=2\n del obj.tag\n correct=obj.__dict__ is d and obj.other==2 and d=={'other':2}\n visit('ok' if correct else 'bad')\n");
  expect(state.events).toEqual(["ok","ok"]);
});

it("limits invalid instance dictionary type names to complete UTF-8 characters",()=>{
  const state=fixture();state.globals.set("BaseException",state.registry.baseExceptionType());state.run("e=BaseException()\n");
  for(const [name,display] of [["X".repeat(250),"X".repeat(200)],["字".repeat(100),"字".repeat(66)]]) {
    state.run(`Wrong=type('${name}',(),{})\nwrong=Wrong()\n`);
    expect(()=>state.run("e.__dict__=wrong\n")).toThrow(`__dict__ must be set to a dictionary, not a '${display}'`);
  }
});

it("adds exception notes through native list storage while preserving list identity",()=>{
  const state=fixture();state.globals.set("BaseException",state.registry.baseExceptionType());state.globals.set("List",state.registry.listType());
  state.run("e=BaseException('message')\nfirst=e.add_note('first')\nnotes=e.__notes__\ne.add_note('second')\nclass L(List):\n def append(self,value):\n  visit('wrong')\ne.__notes__=L()\ne.add_note('third')\ncorrect=first is None and notes==['first','second'] and e.__notes__==['third']\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual([]);
  state.run("e.__notes__=None\n");expect(()=>state.run("e.add_note('x')\n")).toThrow("Cannot add note: __notes__ is not a list");
  expect(()=>state.run("e.add_note(None)\n")).toThrow("add_note() argument must be str, not None");
});

it("validates notes before lookup and exposes the empty list to the attribute setter",()=>{
  const state=fixture();state.globals.set("BaseException",state.registry.baseExceptionType());
  state.run("class E(BaseException):\n def __getattribute__(self,name):\n  if name=='__notes__':\n   visit('get')\n  return object.__getattribute__(self,name)\n def __setattr__(self,name,value):\n  if name=='__notes__':\n   visit('empty' if value==[] else 'not empty')\n  object.__setattr__(self,name,value)\ne=E()\n");
  expect(()=>state.run("e.add_note(1)\n")).toThrow("add_note() argument must be str, not int");expect(state.events).toEqual([]);
  state.run("e.add_note('one')\ne.add_note('two')\ncorrect=e.__notes__==['one','two']\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["get","empty","get","get"]);
  expect(()=>state.run("e.add_note()\n")).toThrow("E.add_note() takes exactly one argument (0 given)");
  expect(()=>state.run("BaseException.add_note(e)\n")).toThrow("BaseException.add_note() takes exactly one argument (0 given)");
});

it("appends to the supplied note list even when an attribute setter discards it",()=>{
  const state=fixture();state.globals.set("BaseException",state.registry.baseExceptionType());
  state.run("captured=[]\nclass E(BaseException):\n def __setattr__(self,name,value):\n  if name=='__notes__':\n   captured.append(value)\n  else:\n   object.__setattr__(self,name,value)\ne=E()\ne.add_note('one')\ne.add_note('two')\ncorrect=captured==[['one'],['two']]\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("preserves note hook failures and does not append before a successful setter",()=>{
  const state=fixture(),owner=state.registry.baseExceptionType();state.globals.set("BaseException",owner);state.run("e=BaseException()\n");
  const descriptor=createExceptionAddNoteDescriptor(owner,state.v,state.meter),receiver=state.globals.get("e")!,keywords=state.v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(state.keys,state.meter));
  const unused=():never=>{throw Error("unexpected call");};
  for(const failure of [Error("host fault"),new ExecutionLimitError("cancelled"),new PythonRuntimeError("ValueError","guest fault")]) {
    expect(()=>descriptor.value.invoke(receiver,[state.v.string("note")],keywords,state.meter,{call:unused,isStopIteration:unused,attribute(){throw failure;},setAttribute:unused})).toThrow(failure);
    let captured:RuntimeValue|undefined;
    expect(()=>descriptor.value.invoke(receiver,[state.v.string("note")],keywords,state.meter,{call:unused,isStopIteration:unused,attribute(){throw new PythonRuntimeError("AttributeError","missing");},setAttribute(_receiver,_name,value){captured=value;throw failure;}})).toThrow(failure);
    expect(captured?.kind).toBe("list");if(captured?.kind==="list")expect(captured.items.length).toBe(0);
  }
});

it("stores exception cause/context independently and enables suppression on cause assignment",()=>{
  const state=fixture();state.globals.set("BaseException",state.registry.baseExceptionType());
  state.run("class E(BaseException):\n pass\ne=E()\nother=BaseException('other')\ninitial=e.__cause__ is None and e.__context__ is None and e.__suppress_context__ is False\ne.__context__=other\ncontext=e.__context__ is other and e.__suppress_context__ is False\ne.__cause__=None\nsuppressed=e.__suppress_context__ is True\ne.__suppress_context__=False\ne.__cause__=other\nlinked=e.__cause__ is other and e.__suppress_context__ is True\ne.__context__=e\ne.__cause__=e\nBaseException.__init__(e,1)\nretained=e.__context__ is e and e.__cause__ is e and e.__suppress_context__ is True\n");
  for(const key of ["initial","context","suppressed","linked","retained"])expect(state.globals.get(key)).toBe(state.v.true);
});

it("validates exception link writes without altering prior state",()=>{
  const state=fixture();state.globals.set("BaseException",state.registry.baseExceptionType());state.run("e=BaseException()\n");
  for(const [name,message] of [["__cause__","exception cause must be None or derive from BaseException"],["__context__","exception context must be None or derive from BaseException"],["__suppress_context__","attribute value type must be bool"]]) {
    expect(()=>state.run(`e.${name}=1\n`)).toThrow(message);
    expect(()=>state.run(`del e.${name}\n`)).toThrow(name==="__suppress_context__"?"can't delete numeric/char attribute":`${name} may not be deleted`);
  }
  state.run("unchanged=e.__cause__ is None and e.__context__ is None and e.__suppress_context__ is False\nclass Shadow(BaseException):\n __cause__='shadow'\nx=Shadow()\nBaseException.__cause__.__set__(x,e)\ninternal=BaseException.__cause__.__get__(x) is e and x.__cause__=='shadow'\n");
  expect(state.globals.get("unchanged")).toBe(state.v.true);expect(state.globals.get("internal")).toBe(state.v.true);
});

it("allocates BaseException storage and formats its captured arguments",()=>{
  const state=fixture();state.globals.set("BaseException",state.registry.baseExceptionType());
  state.run("a=BaseException()\nb=BaseException('message')\nc=BaseException(1,'two')\ncorrect=type(a) is BaseException and a.args==() and b.args==('message',) and c.args==(1,'two') and f'{a}'=='' and f'{b}'=='message' and f'{c}'==\"(1, 'two')\" and f'{a!r}'=='BaseException()' and f'{b!r}'==\"BaseException('message')\" and f'{c!r}'==\"BaseException(1, 'two')\"\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("separates exception allocation from custom initialization and stores instance attributes",()=>{
  const state=fixture();state.globals.set("BaseException",state.registry.baseExceptionType());
  state.run("class E(BaseException):\n def __init__(self,value,**kw):\n  self.tag=kw\ne=E(1,x=2)\nraw=BaseException.__new__(BaseException,3,ignored=4)\ncorrect=e.args==(1,) and e.tag=={'x':2} and raw.args==(3,) and f'{e!r}'=='E(1)'\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(()=>state.run("BaseException(x=1)\n")).toThrow("BaseException() takes no keyword arguments");
  expect(()=>state.run("BaseException.__init__(e,x=1)\n")).toThrow("E() takes no keyword arguments");
});

it("limits default exception initializer diagnostics to 200 UTF-8 bytes",()=>{
  for(const [name,expected] of [["X".repeat(250),"X".repeat(200)],["Ж".repeat(130),"Ж".repeat(100)],["字".repeat(100),"字".repeat(66)]]) {
    const state=fixture();state.globals.set("BaseException",state.registry.baseExceptionType());
    state.run(`class ${name}(BaseException):\n pass\n`);
    let message="";try{state.run(`${name}(x=1)\n`);}catch(error){message=(error as Error).message;}
    expect(message).toBe(`${expected}() takes no keyword arguments`);
  }
});

it("updates exception args from iterables without replacing them after failed conversion",()=>{
  const state=fixture();state.globals.set("BaseException",state.registry.baseExceptionType());
  state.run("e=BaseException(1)\nargs=(2,3)\ne.args=args\nidentity=e.args is args\ne.args=[4,5]\ncorrect=e.args==(4,5) and f'{e}'=='(4, 5)'\n");
  expect(state.globals.get("identity")).toBe(state.v.true);expect(state.globals.get("correct")).toBe(state.v.true);
  expect(()=>state.run("e.args=None\n")).toThrow("'NoneType' object is not iterable");
  state.run("unchanged=e.args==(4,5)\n");expect(state.globals.get("unchanged")).toBe(state.v.true);
  expect(()=>state.run("del e.args\n")).toThrow("args may not be deleted");
});

it("allocates canonical complex instances and owned subclasses with native numeric slots",()=>{
  const state=fixture();state.globals.set("Complex",state.registry.complexType());
  state.run("class Z(Complex):\n pass\nx=Z('1+2j')\ny=Complex(3,4)\ncorrect=type(x) is Z and type(y) is Complex and x==1+2j and x+y==4+6j and 2*x==2+4j and x/2==0.5+1j and x**2==-3+4j and -x==-1-2j and +x==1+2j and not Z() and x.real==1.0 and x.imag==2.0\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(()=>state.run("class Child(Complex):\n def __init__(self,**kw):\n  pass\nChild(tag=1)\n")).toThrow("complex() got an unexpected keyword argument 'tag'");
});

it("prioritizes complex subclass reflected numeric and comparison methods",()=>{
  const state=fixture();state.globals.set("Complex",state.registry.complexType());
  state.run("class Z(Complex):\n def __radd__(self,other):\n  visit('radd')\n  return 9\n def __eq__(self,other):\n  visit('eq')\n  return True\nx=Z(2)\ncorrect=(1j+x)==9 and (1j==x) and Complex.__add__(x,1j)==2+1j\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["radd","eq"]);
});

it("validates complex allocators and preserves constructor result identity rules",()=>{
  const state=fixture();state.globals.set("Complex",state.registry.complexType());
  state.run("class Z(Complex):\n pass\nx=Complex(1,2)\ny=Z(x)\ncorrect=Complex(x) is x and Complex.__new__(Complex,x) is x and type(y) is Z and y is not x and Complex(y) is not y\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(()=>state.run("Complex.__new__()\n")).toThrow("complex.__new__(): not enough arguments");
  expect(()=>state.run("Complex.__new__(None)\n")).toThrow("complex.__new__(X): X is not a type object (NoneType)");
  expect(()=>state.run("Complex.__new__(object)\n")).toThrow("complex.__new__(object): object is not a subtype of complex");
});

it("publishes complex members and methods that inspect storage without conversion overrides",()=>{
  const state=fixture();state.globals.set("Complex",state.registry.complexType());state.globals.set("Float",state.registry.floatType());
  state.run("class Z(Complex):\n def __complex__(self):\n  visit('wrong')\n  return 9j\nx=Complex(1,2)\ny=Z(1,2)\ncorrect=type(y.real) is Float and y.real==1.0 and y.imag==2.0 and Complex.real.__objclass__ is Complex and Complex.real.__get__(y)==1.0 and x.__complex__() is x and Complex.__complex__(y)==x and y.conjugate()==1-2j and y.__getnewargs__()==(1.0,2.0) and type(+y) is Complex and y.__abs__()==x.__abs__() and f'{y!r}'=='(1+2j)'\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual([]);
  expect(()=>state.run("y.real=2\n")).toThrow("readonly attribute");
});

it("hashes owned complex NaN components using the instance identity",()=>{
  const state=fixture(),owner=state.registry.complexType();state.globals.set("Complex",owner);
  state.run("class Z(Complex):\n pass\nx=Z('nan+nanj')\n");
  const value=state.globals.get("x")!,descriptor=owner.value.namespace.items.lookup(state.v.string("__hash__"))?.value;
  if(descriptor?.kind!=="wrapper_descriptor")throw Error("expected complex hash descriptor");
  const keywords=state.v.dictionary(owner.value.namespace.items.emptyCopy());
  const result=descriptor.value.invoke(value,[],keywords,state.meter,{nativeHash:()=>17n,identityHash:receiver=>receiver===value?31n:17n,call():never{throw Error("unexpected call");},isStopIteration:()=>false});
  expect(result).toEqual(state.v.integer(31000124));
});

it("renders invalid float buffer inputs before releasing their leases", () => {
  const events:string[]=[];
  const state=fixture(undefined,undefined,{buffers:{acquireSimple(){events.push("acquire");return {byteLength:3,copy(){events.push("copy");return state.v.bytes(Uint8Array.of(98,97,100)).value;},release(){events.push("release");}};}}});
  state.globals.set("Float",state.registry.floatType());
  state.run("class Buffer:\n def __repr__(self):\n  visit('repr')\n  return 'custom'\n");
  state.builtins.set("visit",state.v.builtinFunction({name:"visit",invoke(){events.push("repr");return state.v.none;}}));
  expect(()=>state.run("Float(Buffer())\n")).toThrow("could not convert string to float: custom");
  expect(events).toEqual(["acquire","copy","repr","release"]);
  events.length=0;
  state.run("class Broken:\n def __repr__(self):\n  visit('repr')\n  return 1/0\n");
  expect(()=>state.run("Float(Broken())\n")).toThrow("division by zero");
  expect(events).toEqual(["acquire","copy","repr","release"]);
});

it("passes execution buffer leases to canonical numeric constructors", () => {
  const events:string[]=[];
  const state=fixture(undefined,undefined,{buffers:{acquireSimple(){events.push("acquire");return {byteLength:2,copy(){events.push("copy");return state.v.bytes(Uint8Array.of(49,50)).value;},release(){events.push("release");}};}}});
  state.globals.set("Float",state.registry.floatType());state.globals.set("Int",state.registry.integerType());state.globals.set("source",state.v.cell({}));
  state.run("class F(Float):\n pass\nclass I(Int):\n pass\ncorrect=Float(source)==12.0 and Int(source)==12 and F(source)==12.0 and I(source)==12\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(events).toEqual(Array(4).fill(["acquire","copy","release"]).flat());
  expect(()=>state.run("Int(source,2)\n")).toThrow("int() can't convert non-string with explicit base");
  expect(events).toHaveLength(12);
});

it("uses execution bytearray storage for numeric constructor parsing", () => {
  const bytes={byteString(){return undefined;},lookupBytes(){return undefined;},typeName(){return "bytearray";},byteArray(){expect(this).toBe(bytes);return state.v.bytes(Uint8Array.of(49,48)).value;}};
  const state=fixture(undefined,undefined,{bytes,buffers:{acquireSimple():never{throw Error("bytearray must not acquire a general buffer");}}});
  state.globals.set("Float",state.registry.floatType());state.globals.set("Int",state.registry.integerType());state.globals.set("source",state.v.cell({}));
  state.run("correct=Float(source)==10.0 and Int(source)==10 and Int(source,2)==2\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("invokes guest bytes conversion for bytes percent fields", () => {
  const state=fixture();
  state.run("class Data:\n def __bytes__(self):\n  visit('bytes')\n  return b'abc'\nx=Data()\ncorrect=b'%b'%x==b'abc' and b'%.2s'%(x,)==b'ab'\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["bytes","bytes"]);
  state.run("class Bad:\n def __bytes__(self):\n  return 'wrong'\n");
  expect(()=>state.run("b'%b'%Bad()\n")).toThrow("__bytes__ returned non-bytes (type str)");
});

it("binds tuple subclass percent arguments from stored elements", () => {
  const state=fixture();state.globals.set("Tuple",state.registry.tupleType());
  state.run("class Args(Tuple):\n def __getitem__(self,key):\n  visit('wrong')\n  return 9\n def __iter__(self):\n  visit('wrong')\n  return None\n def __len__(self):\n  visit('wrong')\n  return 0\nx=Args((3,1.25))\ncorrect='%d %.2f'%x=='3 1.25' and b'%d %.2f'%x==b'3 1.25'\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual([]);
  expect(()=>state.run("'%(x)s'%x\n")).toThrow("format requires a mapping");
});

it("forwards percent mapping proxy lookups through wrapped guest mappings", () => {
  const state=fixture();state.globals.set("Proxy",state.registry.mappingProxyType());state.globals.set("Dict",state.registry.dictionaryType());
  state.run("class Child(Dict):\n def __getitem__(self,key):\n  visit('get')\n  return 7\nx=Proxy(Proxy(Child(x=1)))\ncorrect='%(x)d'%x=='7' and b'%(x)d'%x==b'7'\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["get","get"]);
});

it("dispatches percent mapping keys through guest subscription", () => {
  const state=fixture();state.globals.set("Dict",state.registry.dictionaryType());
  state.run("class Mapping:\n def __getitem__(self,key):\n  if key=='x':\n   visit('text')\n  elif key==b'x':\n   visit('bytes')\n  return 3\nclass Child(Dict):\n def __getitem__(self,key):\n  visit('dict')\n  return 7\nx=Mapping()\ncorrect='%(x)d'%x=='3' and b'%(x)d'%x==b'3' and '%(x)d'%Child(x=1)=='7' and 'unchanged'%x=='unchanged'\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["text","bytes","dict"]);
});

it("formats owned float percent operands without numeric override calls", () => {
  const state=fixture();state.globals.set("Float",state.registry.floatType());
  state.run("class Child(Float):\n def __float__(self):\n  visit('wrong')\n  return 9.0\n def __int__(self):\n  visit('int')\n  return 7\nx=Child(1.25)\ncorrect='%.2f'%x=='1.25' and b'%.2f'%x==b'1.25' and '%d'%x=='7'\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["int"]);
});

it("shares numeric conversion and representation callbacks with percent formatting", () => {
  const state=fixture();state.globals.set("Int",state.registry.integerType());
  state.run("class Number:\n def __float__(self):\n  visit('float')\n  return 1.25\n def __int__(self):\n  visit('int')\n  return 3\n def __index__(self):\n  visit('index')\n  return 15\n def __str__(self):\n  visit('str')\n  return 'custom'\nclass Integer(Int):\n def __int__(self):\n  visit('wrong')\n  return 0\nx=Number()\ncorrect='%.2f %d %x %s'%(x,x,x,x)=='1.25 3 f custom' and '%d'%Integer(7)=='7' and '%*d'%(Integer(3),2)=='  2'\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["float","int","index","str"]);
});

it("reports virtual IEEE formats through the float class descriptor", () => {
  const state=fixture();state.globals.set("Float",state.registry.floatType());
  state.run("class Child(Float):\n pass\ncorrect=Float.__getformat__('float')=='IEEE, little-endian' and Child.__getformat__('double')=='IEEE, little-endian' and Child.__getformat__.__self__ is Child and (1.0).__getformat__.__self__ is Float\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(()=>state.run("Child.__getformat__()\n")).toThrow("Child.__getformat__() takes exactly one argument (0 given)");
  expect(()=>state.run("Float.__getformat__(None)\n")).toThrow("__getformat__() argument must be str, not None");
  expect(()=>state.run("Float.__getformat__('Float')\n")).toThrow("__getformat__() argument 1 must be 'double' or 'float'");
  expect(()=>state.run("Float.__getformat__('f\\x00')\n")).toThrow("embedded null character");
  expect(()=>state.run("Float.__getformat__('\\x00\\ud800')\n")).toThrow("surrogates not allowed");
});

it("bypasses float subclass conversion only for from_number", () => {
  const state=fixture();state.globals.set("Float",state.registry.floatType());
  state.run("class Stored(Float):\n def __float__(self):\n  visit('float')\n  return 9.0\nx=Stored(2.0)\ncorrect=Float.from_number(x)==2.0 and type(Float.from_number(x)) is Float and Stored.from_number(x)==2.0 and type(Stored.from_number(x)) is Stored and Float(x)==9.0\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["float"]);
});

it("constructs floats from numbers without text parsing", () => {
  const state=fixture();state.globals.set("Float",state.registry.floatType());
  state.run("class Child(Float):\n def __new__(cls,value):\n  visit('new')\n  return Float.__new__(cls,value)\n def __init__(self,value):\n  visit('init')\nclass Number:\n def __float__(self):\n  visit('float')\n  return 1.25\nclass Index:\n def __index__(self):\n  visit('index')\n  return 2\nx=1.25\ny=Child.from_number(Number())\ncorrect=Float.from_number(x) is x and type(y) is Child and y==x and Float.from_number(Index())==2.0 and Float.from_number(True)==1.0 and y.from_number.__self__ is Child\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["float","new","init","index"]);
  expect(()=>state.run("Child.from_number('1.25')\n")).toThrow("must be real number, not str");
  expect(()=>state.run("Float.from_number(b'1.25')\n")).toThrow("must be real number, not bytes");
  expect(state.events).toEqual(["float","new","init","index"]);
  state.run("Long=type('x'*80,(object,),{})\n");
  expect(()=>state.run("Float.from_number(Long())\n")).toThrow(expect.objectContaining({message:`must be real number, not ${"x".repeat(50)}`}));
});

it("constructs float subclasses through inherited fromhex after parsing", () => {
  const state=fixture();state.globals.set("Float",state.registry.floatType());
  state.run("class Child(Float):\n def __new__(cls,value):\n  visit('new')\n  return Float.__new__(cls,value)\n def __init__(self,value):\n  visit('init')\nx=Child.fromhex('0x1.8p1')\ncorrect=type(x) is Child and x==3.0 and Child.fromhex.__self__ is Child and x.fromhex.__self__ is Child and Float.fromhex('0x1p0')==1.0\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["new","init"]);
  expect(()=>state.run("Child.fromhex('invalid')\n")).toThrow("invalid hexadecimal floating-point string");
  expect(state.events).toEqual(["new","init"]);
  state.run("class Other(Float):\n def __new__(cls,value):\n  return 'other'\nresult=Other.fromhex('0x1p0')\n");
  expect(state.globals.get("result")).toEqual(state.v.string("other"));
  expect(()=>state.run("Child.fromhex()\n")).toThrow("Child.fromhex() takes exactly one argument (0 given)");
  expect(()=>state.run("Child.fromhex(string='0x1p0')\n")).toThrow("Child.fromhex() takes no keyword arguments");
});

it("converts complex from_number through numeric protocols and bypasses native subclass overrides",()=>{
  const state=fixture();state.globals.set("Complex",state.registry.complexType());state.globals.set("Float",state.registry.floatType());
  state.run("class Z(Complex):\n def __complex__(self):\n  visit('wrong')\n  return 9j\nclass F(Float):\n def __float__(self):\n  visit('wrong')\n  return 9.0\nclass Number:\n def __complex__(self):\n  visit('complex')\n  return 1+2j\nclass Index:\n def __index__(self):\n  visit('index')\n  return 4\nx=1+2j\ncorrect=Complex.from_number(x) is x and Complex.from_number(Z(1,2))==x and Complex.from_number(F(3))==3+0j and Complex.from_number(Number())==x and Complex.from_number(Index())==4+0j and Complex.from_number.__self__ is Complex\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["complex","index"]);
  expect(()=>state.run("Complex.from_number('1')\n")).toThrow("must be real number, not str");
  expect(()=>state.run("Complex.from_number(None)\n")).toThrow("must be real number, not NoneType");
});

it("calls the bound complex subclass constructor after from_number conversion",()=>{
  const state=fixture();state.globals.set("Complex",state.registry.complexType());
  state.run("class Z(Complex):\n def __init__(self,value):\n  self.tag='initialized'\nx=Z.from_number(2)\ncorrect=type(x) is Z and x==2+0j and x.tag=='initialized'\nclass Other(Complex):\n def __new__(cls,value):\n  return 'other'\nresult=Other.from_number(2)\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.globals.get("result")).toEqual(state.v.string("other"));
  expect(()=>state.run("Z.from_number()\n")).toThrow("Z.from_number() takes exactly one argument (0 given)");
  expect(()=>state.run("Z.from_number(number=1)\n")).toThrow("Z.from_number() takes no keyword arguments");
});

it("shares complex result warnings and never requests buffers in from_number",()=>{
  const state=fixture(),{v,meter}=state,owner=state.registry.complexType();state.globals.set("Complex",owner);
  state.run("class Z(Complex):\n pass\nx=Z(1,2)\n");
  const owned=state.globals.get("x")!,source=v.cell({}),warnings:string[]=[];
  const method=owner.value.namespace.items.lookup(v.string("from_number"))?.value;
  if(method?.kind!=="classmethod_descriptor")throw Error("expected complex from_number descriptor");
  const keywords=v.dictionary(owner.value.namespace.items.emptyCopy());
  const invocation={isStopIteration:()=>false,typeName:()=>"Z",lookupSpecial:(value:RuntimeValue,name:string)=>value===source&&name==="__complex__"?v.none:undefined,call:()=>owned,warn:(_category:string,message:string)=>warnings.push(message),buffers:{acquireSimple():never{throw Error("unexpected buffer acquisition");}}};
  expect(method.value.invoke(owner,[source],keywords,meter,invocation)).toEqual(v.complex(1,2));
  expect(warnings).toEqual(["__complex__ returned non-complex (type Z).  The ability to return an instance of a strict subclass of complex is deprecated, and may be removed in a future version of Python."]);
  const fatal=new Error("warning filter");
  expect(()=>method.value.invoke(owner,[source],keywords,meter,{...invocation,warn:()=>{throw fatal;}})).toThrow(fatal);
  expect(()=>method.value.invoke(owner,[v.bytes([49])],keywords,meter,invocation)).toThrow("must be real number, not Z");
});

it("formats owned complex storage while preserving empty-spec string overrides",()=>{
  const state=fixture();state.globals.set("Complex",state.registry.complexType());
  state.run("class Z(Complex):\n def __str__(self):\n  visit('str')\n  return 'custom'\n def __complex__(self):\n  visit('wrong')\n  return 9j\nx=Z(1.25,2.5)\ncorrect=Complex.__format__(x,'')=='custom' and x.__format__('.1f')=='1.2+2.5j' and f'{x:.2f}'=='1.25+2.50j' and x.__format__('n')=='1.25+2.5j' and Complex.__format__.__objclass__ is Complex\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["str"]);
  expect(()=>state.run("x.__format__('q')\n")).toThrow("Unknown format code 'q' for object of type 'Z'");
  expect(()=>state.run("x.__format__(None)\n")).toThrow("__format__() argument must be str, not None");
  expect(()=>state.run("x.__format__()\n")).toThrow("complex.__format__() takes exactly one argument (0 given)");
});

it("resolves complex numeric locale only for locale-aware formatting",()=>{
  const state=fixture(),{v,meter}=state;let reads=0;
  const locale=new NumericLocale({decimalPoint:v.string(",").value,thousandsSeparator:v.string(".").value,grouping:[3,0]},meter);
  const formatting=createRuntimeFormatContext(v,meter,{numericLocale(){reads++;return locale;},defaultRepr(){throw Error("unexpected representation");}});
  const method=state.registry.complexType().value.namespace.items.lookup(v.string("__format__"))?.value;
  if(method?.kind!=="method_descriptor")throw Error("expected complex format descriptor");
  const keywords=v.dictionary(state.registry.complexType().value.namespace.items.emptyCopy()),invocation={formatting,call():never{throw Error("unexpected guest call");}};
  expect(method.value.invoke(v.complex(1234.5,6789),[v.string(".1f")],keywords,meter,invocation)).toEqual(v.string("1234.5+6789.0j"));expect(reads).toBe(0);
  expect(method.value.invoke(v.complex(1234.5,6789),[v.string("n")],keywords,meter,invocation)).toEqual(v.string("1.234,5+6.789j"));expect(reads).toBe(1);
});

it("formats float subclass storage while preserving empty-spec string overrides", () => {
  const state=fixture();state.globals.set("Float",state.registry.floatType());
  state.run("class Child(Float):\n def __str__(self):\n  visit('str')\n  return 'custom'\n def __float__(self):\n  visit('wrong')\n  return 9.0\nx=Child(1.25)\ncorrect=Float.__format__(x,'')=='custom' and x.__format__('.1f')=='1.2' and f'{x:.2f}'=='1.25' and x.__format__('n')=='1.25' and Float.__format__.__objclass__ is Float\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["str"]);
  expect(()=>state.run("x.__format__('q')\n")).toThrow("Unknown format code 'q' for object of type 'Child'");
});

it("shares numeric locale lazily with explicit float formatting", () => {
  const state=fixture();const {v,meter}=state;let reads=0;
  const locale=new NumericLocale({decimalPoint:v.string(",").value,thousandsSeparator:v.string(".").value,grouping:[3,0]},meter);
  const formatting=createRuntimeFormatContext(v,meter,{numericLocale(){reads++;return locale;},defaultRepr(){throw Error("unexpected representation");}});
  const method=state.registry.floatType().value.namespace.items.lookup(v.string("__format__"))?.value;
  if(method?.kind!=="method_descriptor")throw Error("expected float format descriptor");
  const keywords=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(state.keys,meter));
  const invocation={formatting,call():never{throw Error("unexpected guest call");}};
  expect(method.value.invoke(v.float(1234.5),[v.string(".1f")],keywords,meter,invocation)).toEqual(v.string("1234.5"));expect(reads).toBe(0);
  expect(method.value.invoke(v.float(1234.5),[v.string("n")],keywords,meter,invocation)).toEqual(v.string("1.234,5"));expect(reads).toBe(1);
});

it("rounds owned floats through the canonical descriptor and index protocol", () => {
  const state=fixture();state.globals.set("Float",state.registry.floatType());state.globals.set("Int",state.registry.integerType());
  state.builtins.set("round",createRoundBuiltin(state.v,state.meter));
  state.run("class Child(Float):\n def __float__(self):\n  visit('wrong')\n  return 9.0\nclass Digits:\n def __index__(self):\n  visit('index')\n  return 1\nx=Child(1.25)\ncorrect=round(x)==1 and type(round(x)) is Int and x.__round__(None)==1 and x.__round__(Digits())==1.2 and type(x.__round__(2)) is Float and Float.__round__(2.5)==2 and Float.__round__(3.5)==4 and Float.__round__.__objclass__ is Float\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["index"]);
  expect(()=>state.run("x.__round__(ndigits=1)\n")).toThrow("takes no keyword arguments");
});

it("publishes float data descriptors without invoking subclass conversions", () => {
  const state=fixture();state.globals.set("Float",state.registry.floatType());
  state.run("class Child(Float):\n def __float__(self):\n  visit('wrong')\n  return 9.0\nx=1.25\ny=Child(x)\ncorrect=Float.real.__get__(x) is x and x.real is x and y.real==x and type(y.real) is Float and y.imag==0.0 and type(y.imag) is Float and Float.imag.__objclass__ is Float\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual([]);
  expect(()=>state.run("y.real=2\n")).toThrow("not writable");
  expect(()=>state.run("del y.imag\n")).toThrow("not writable");
});

it("publishes native float numeric methods with correct identity and result types", () => {
  const state=fixture();state.globals.set("Float",state.registry.floatType());
  state.run("class Child(Float):\n def __float__(self):\n  visit('wrong')\n  return 9.0\nx=1.25\ny=Child(x)\ncorrect=x.conjugate() is x and y.conjugate()==x and type(y.conjugate()) is Float and y.as_integer_ratio()==(5,4) and not y.is_integer() and Float.is_integer(2.0) and y.hex()=='0x1.4000000000000p+0' and y.__trunc__()==1 and y.__floor__()==1 and y.__ceil__()==2 and (-1.25).__floor__()==-2 and (-1.25).__ceil__()==-1 and x.__getnewargs__()==(x,) and x.__getnewargs__()[0] is not x and type(y.__getnewargs__()[0]) is Float and Float.hex.__objclass__ is Float and y.hex.__self__ is y\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual([]);
});

it("reflects boolean comparisons to float subclasses without bypassing overrides", () => {
  const state = fixture();state.globals.set("Float",state.registry.floatType());
  state.run("class Child(Float):\n def __eq__(self,other):\n  visit('equal')\n  return 7\nx=Child(1.0)\nresult=True==x\ncomplex_result=(1+0j)==x\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(7));
  expect(state.globals.get("complex_result")).toBe(state.v.true);expect(state.events).toEqual(["equal"]);
});

it("hashes owned float NaNs using the instance identity rather than backing storage", () => {
  const state = fixture();state.globals.set("Float",state.registry.floatType());
  state.run("class Child(Float):\n pass\nx=Child('nan')\n");
  const value=state.globals.get("x")!,descriptor=state.registry.floatType().value.namespace.items.lookup(state.v.string("__hash__"))?.value;
  if(descriptor?.kind!=="wrapper_descriptor")throw Error("expected float hash descriptor");
  const keywords=state.v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(state.keys,state.meter));
  const result=descriptor.value.invoke(value,[],keywords,state.meter,{nativeHash:()=>17n,identityHash:receiver=>receiver===value?31n:17n,call():never{throw Error("unexpected call");},isStopIteration:()=>false});
  expect(result).toEqual(state.v.integer(31));
});

it("allocates canonical floats and distinct subclass-owned float payloads", () => {
  const state = fixture();state.globals.set("Float",state.registry.floatType());
  state.run("x=1.25\nclass Child(Float):\n def __init__(self,value):\n  self.tag='child'\ny=Child(x)\ncorrect=Float(x) is x and type(x) is Float and type(y) is Child and y.tag=='child' and Float(y)==x and Float(y) is not y and Float.__base__ is object and Float.__new__.__self__ is Float\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("uses float subclass numeric slots and reflected override priority", () => {
  const state = fixture();state.globals.set("Float",state.registry.floatType());
  state.run("class Child(Float):\n pass\nx=Child(2.5)\ncorrect=x+1==3.5 and 1+x==3.5 and x*2==5.0 and 2*x==5.0 and x-1==1.5 and 8/x==3.2 and 8//x==3.0 and x%2==0.5 and x**2==6.25 and x>2 and x==2.5 and -x==-2.5 and +x==2.5 and x.__int__()==2 and x.__bool__() and f'{x!r}'=='2.5'\nclass Reflected(Float):\n def __radd__(self,other):\n  visit('reflected')\n  return 9\npriority=1.0+Reflected(2.0)\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.globals.get("priority")).toEqual(state.v.integer(9));expect(state.events).toEqual(["reflected"]);
  state.globals.set("NI",state.v.notImplemented);
  state.run("class Declines(Float):\n def __radd__(self,other):\n  visit('declines')\n  return NI\nfallback=1.0+Declines(2.0)\n");
  expect(state.globals.get("fallback")).toEqual(state.v.float(3));expect(state.events).toEqual(["reflected","declines"]);
  state.run("mixed=True+Reflected(2.0)\n");
  expect(state.globals.get("mixed")).toEqual(state.v.integer(9));
});

it("lets overridden float initializers consume keyword arguments", () => {
  const state = fixture();state.globals.set("Float",state.registry.floatType());
  state.run("class Child(Float):\n def __init__(self,tag):\n  self.tag=tag\nx=Child(tag='yes')\ncorrect=x==0.0 and x.tag=='yes'\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(()=>state.run("Float(tag='no')\n")).toThrow("float() takes no keyword arguments");
});

it("constructs floats from native values and text while retaining exact float identity", () => {
  const state = fixture();
  state.builtins.set("Float",state.v.builtinFunction({name:"float",invoke(args,keywords,meter,invocation){return constructRuntimeFloat(args,keywords,state.v,meter,{invocation});}}));
  state.run("x=1.25\ncorrect=Float(x) is x and Float()==0.0 and Float(True)==1.0 and Float(10**30)==1e30 and Float(' ١.٢e٣ ')==1200.0 and Float(b'1_2.5')==12.5\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(()=>state.run("Float(1,2)\n")).toThrow("float expected at most 1 argument, got 2");
  expect(()=>state.run("Float(x=1)\n")).toThrow("float() takes no keyword arguments");
});

it("prefers float conversion to index and never falls back to int or bytes methods", () => {
  const state = fixture();
  state.builtins.set("Float",state.v.builtinFunction({name:"float",invoke(args,keywords,meter,invocation){return constructRuntimeFloat(args,keywords,state.v,meter,{invocation});}}));
  state.run("x=1.25\nclass Both:\n def __float__(self):\n  visit('float')\n  return x\n def __index__(self):\n  visit('wrong')\n  return 2\nclass Index:\n def __index__(self):\n  visit('index')\n  return 3\nclass IntOnly:\n def __int__(self):\n  visit('wrong')\n  return 1\n def __bytes__(self):\n  visit('wrong')\n  return b'1'\ncorrect=Float(Both()) is x and Float(Index())==3.0\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(()=>state.run("Float(IntOnly())\n")).toThrow("float() argument must be a string or a real number, not 'IntOnly'");
  expect(state.events).toEqual(["float","index"]);
});

it("formats slices through object formatting and guest component repr", () => {
  const state = fixture();state.globals.set("Slice",state.registry.sliceType());
  state.run("class Part:\n def __repr__(self):\n  visit('repr')\n  return 'part'\ns=Slice(Part())\ncorrect=s.__format__('')=='slice(None, part, None)' and f'{s}'=='slice(None, part, None)'\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["repr","repr"]);
  expect(()=>state.run("s.__format__('x')\n")).toThrow("unsupported format string passed to slice.__format__");
  expect(()=>state.run("s.__format__()\n")).toThrow("object.__format__() takes exactly one argument (0 given)");
});

it("retains host byte protocol storage when calling integer from_bytes", () => {
  const state = fixture();const { v, meter } = state;
  const owner = state.registry.integerType(), descriptor = owner.value.namespace.items.lookup(v.string("from_bytes"))?.value;
  if(descriptor?.kind !== "classmethod_descriptor")throw Error("expected from_bytes descriptor");
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(state.keys,meter));
  const opaque = v.list([]), bytes = v.bytes([7]).value;
  const events: string[] = [];
  const result = descriptor.value.invoke(owner,[opaque],keywords,meter,{
    call(): never { throw Error("unexpected guest call"); }, isStopIteration: () => false,
    bytes: { lookupBytes: () => () => { events.push("bytes"); return opaque; }, byteString: value => value === opaque ? bytes : undefined, typeName: () => "Opaque" }
  });
  expect(result).toEqual(v.integer(7));expect(events).toEqual(["bytes"]);
});

it("names guest byteorder types without attempting their conversion", () => {
  const state = fixture();state.globals.set("Int",state.registry.integerType());
  state.run("class Order:\n def __str__(self):\n  visit('wrong')\n  return 'big'\norder=Order()\n");
  expect(()=>state.run("Int.from_bytes(b'1',order)\n")).toThrow("from_bytes() argument 'byteorder' must be str, not Order");
  expect(()=>state.run("Int.to_bytes(1,2,order)\n")).toThrow("to_bytes() argument 'byteorder' must be str, not Order");
  expect(state.events).toEqual([]);
});

it("publishes integer byte conversion with class binding and owned payloads", () => {
  const state = fixture();state.globals.set("Int",state.registry.integerType());state.globals.set("Bool",state.registry.booleanType());
  state.run("class Child(Int):\n def __init__(self,value):\n  visit('init')\n  self.tag='child'\n def __int__(self):\n  visit('wrong')\n  return 0\nx=Child.from_bytes(b'\\x01\\x02','big')\ncorrect=type(x) is Child and x.tag=='child' and x==258 and x.to_bytes(2,'little')==b'\\x02\\x01' and Int.to_bytes(x,2)==b'\\x01\\x02' and Bool.from_bytes(b'\\x02') is True and Child.from_bytes.__self__ is Child and x.from_bytes.__self__ is Child and Int.to_bytes.__objclass__ is Int\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["init"]);
});

it("converts integer byte inputs before invoking a subclass constructor", () => {
  const state = fixture();state.globals.set("Int",state.registry.integerType());
  state.run("class Source:\n def __bytes__(self):\n  visit('bytes')\n  return b'\\x03'\nclass Signed:\n def __bool__(self):\n  visit('signed')\n  return False\nclass Child(Int):\n def __new__(cls,value):\n  visit('new')\n  return ('replacement',value)\nresult=Child.from_bytes(Source(),signed=Signed())\n");
  expect(state.globals.get("result")).toEqual(state.v.tuple([state.v.string("replacement"),state.v.integer(3)]));
  expect(state.events).toEqual(["signed","bytes","new"]);
});

it("shares the execution numeric locale with explicit integer formatting", () => {
  const state = fixture(); const { v, meter } = state;
  let reads = 0;
  const locale = new NumericLocale({ decimalPoint: v.string(",").value, thousandsSeparator: v.string(".").value, grouping: [3,0] }, meter);
  const formatting = createRuntimeFormatContext(v, meter, { numericLocale() { reads++; return locale; }, defaultRepr() { throw Error("unexpected representation"); } });
  const method = state.registry.integerType().value.namespace.items.lookup(v.string("__format__"))?.value;
  if (method?.kind !== "method_descriptor") throw Error("expected integer format descriptor");
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(state.keys,meter));
  const invocation = { formatting, call(): never { throw Error("unexpected guest call"); } };
  expect(method.value.invoke(v.integer(1234567),[v.string("d")],keywords,meter,invocation)).toEqual(v.string("1234567"));
  expect(reads).toBe(0);
  expect(method.value.invoke(v.integer(1234567),[v.string("n")],keywords,meter,invocation)).toEqual(v.string("1.234.567"));
  expect(reads).toBe(1);
});

it("formats owned integer payloads while preserving empty-spec string overrides", () => {
  const state = fixture();state.globals.set("Int",state.registry.integerType());
  state.run("class Child(Int):\n def __str__(self):\n  visit('str')\n  return 'custom'\n def __int__(self):\n  visit('wrong')\n  return 0\ny=Child(255)\ncorrect=Int.__format__(y,'')=='custom' and y.__format__('#06x')=='0x00ff' and f'{y:d}'=='255' and y.__format__('n')=='255' and Int.__format__(True,'')=='True' and Int.__format__(True,'d')=='1' and Int.__format__.__objclass__ is Int\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["str"]);
  expect(()=>state.run("y.__format__('q')\n")).toThrow("Unknown format code 'q' for object of type 'Child'");
});

it("rounds owned integers through the canonical descriptor with index conversion", () => {
  const state = fixture();state.globals.set("Int",state.registry.integerType());
  state.builtins.set("round",createRoundBuiltin(state.v,state.meter));
  state.run("class Child(Int):\n def __int__(self):\n  visit('wrong')\n  return 0\nclass Digits:\n def __index__(self):\n  visit('index')\n  return -1\nx=10**30\ny=Child(25)\ncorrect=Int.__round__(x) is x and x.__round__(None) is x and y.__round__(Digits())==20 and round(y,-1)==20 and type(y.__round__()) is Int and type(True.__round__()) is Int and (-35).__round__(-1)==-40 and y.__round__(-10**30)==0 and Int.__round__.__objclass__ is Int\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["index"]);
  expect(()=>state.run("y.__round__(ndigits=1)\n")).toThrow("int.__round__() takes no keyword arguments");
  expect(()=>state.run("y.__round__(1,2)\n")).toThrow("__round__ expected at most 1 argument, got 2");
});

it("publishes integer numeric data descriptors over exact and owned values", () => {
  const state = fixture();state.globals.set("Int",state.registry.integerType());
  state.run("class Child(Int):\n def __int__(self):\n  visit('wrong')\n  return 9\nx=10**30\ny=Child(x)\ncorrect=Int.real.__get__(x) is x and x.numerator is x and y.real==x and type(y.real) is Int and y.numerator==x and y.imag==0 and y.denominator==1 and True.real==1 and type(True.real) is Int and Int.real.__objclass__ is Int\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual([]);
  expect(()=>state.run("y.real=2\n")).toThrow("not writable");
  expect(()=>state.run("del y.numerator\n")).toThrow("not writable");
});

it("publishes integer no-argument methods without invoking conversion overrides", () => {
  const state = fixture();state.globals.set("Int",state.registry.integerType());
  state.run("class Child(Int):\n def __int__(self):\n  visit('wrong')\n  return 9\nx=10**30\ny=Child(x)\ncorrect=Int.bit_length(y)==100 and y.bit_count()==37 and y.as_integer_ratio()==(x,1) and y.__getnewargs__()==(x,) and type(y.__getnewargs__()[0]) is Int and y.is_integer() and True.is_integer() and Int.bit_count.__objclass__ is Int and y.bit_count.__self__ is y\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  for(const name of ["conjugate","__trunc__","__floor__","__ceil__"]) {
    state.run(`correct=x.${name}() is x and y.${name}()==x and type(y.${name}()) is Int and type(True.${name}()) is Int\n`);
    expect(state.globals.get("correct")).toBe(state.v.true);
  }
  expect(state.events).toEqual([]);
});

it("constructs singleton booleans under the canonical integer hierarchy", () => {
  const state = fixture();state.globals.set("Bool",state.registry.booleanType());state.globals.set("Int",state.registry.integerType());
  state.run("class Truth:\n def __bool__(self):\n  visit('bool')\n  return True\ncorrect=Bool() is False and Bool(1) is True and Bool(Truth()) is True and type(True) is Bool and Bool.__base__ is Int and Bool.__mro__==(Bool,Int,object) and Bool.__new__.__self__ is Bool\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["bool"]);
  expect(()=>state.run("class Child(Bool):\n pass\n")).toThrow("type 'bool' is not an acceptable base type");
  expect(()=>state.run("Int.__new__(Bool,1)\n")).toThrow("int.__new__(bool) is not safe, use bool.__new__()");
});

it("publishes boolean bitwise slots while inheriting integer conversion slots", () => {
  const state = fixture();state.globals.set("Bool",state.registry.booleanType());state.globals.set("Int",state.registry.integerType());
  state.run("correct=Bool.__and__(True,False) is False and Bool.__or__(False,True) is True and Bool.__xor__(True,True) is False and type(Bool.__and__(True,3)) is Int and True.__int__()==1 and True.__repr__()=='True' and Int.__repr__(True)=='1' and Bool.__int__ is Int.__int__\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("publishes read-only selected type bases rather than the first declared base", () => {
  const state = fixture();state.globals.set("Int",state.registry.integerType());
  state.run("class Empty:\n __slots__=()\nclass Child(Empty,Int):\n pass\ncorrect=object.__base__ is None and Child.__base__ is Int and Child.__bases__==(Empty,Int) and type.__dict__['__base__'].__objclass__ is type\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(()=>state.run("Child.__base__=object\n")).toThrow("readonly attribute");
  expect(()=>state.run("del Child.__base__\n")).toThrow("readonly attribute");
});

it("accepts owned integer hash results without invoking conversion overrides", () => {
  const state = fixture(); state.globals.set("Int",state.registry.integerType());
  state.builtins.set("hash",createHashBuiltin(state.v,state.meter,state.hash));
  state.run("class Child(Int):\n def __index__(self):\n  visit('wrong')\n  return 0\n def __int__(self):\n  visit('wrong')\n  return 0\nclass Key:\n def __hash__(self):\n  visit('hash')\n  return Child(7)\nk=Key()\nresult=hash(k)\nd={k:9}\ncorrect=result==7 and d[k]==9\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(state.events).toEqual(["hash","hash","hash"]);
});

it("accepts owned integer length hints without invoking conversion overrides", () => {
  const state = fixture(); state.globals.set("Int",state.registry.integerType());
  state.run("class Child(Int):\n def __index__(self):\n  visit('wrong')\n  return 0\n def __int__(self):\n  visit('wrong')\n  return 0\nclass Source:\n def __iter__(self):\n  visit('iter')\n  return [1,2].__iter__()\n def __length_hint__(self):\n  visit('hint')\n  return Child(2)\nresult=type([])(Source())\n");
  expect(state.globals.get("result")).toEqual(state.v.list([state.v.integer(1),state.v.integer(2)]));
  expect(state.events).toEqual(["iter","hint"]);
});

it("allocates canonical integers and subclass-owned integer storage", () => {
  const state = fixture(); state.globals.set("Int",state.registry.integerType());
  state.run("x=10**30\nclass Child(Int):\n def __init__(self,value):\n  self.tag='child'\ny=Child(x)\ncorrect=Int(x) is x and type(y) is Child and y.tag=='child' and Int(y)==x and Int(y) is not y and Int.__new__.__self__ is Int\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("uses inherited integer arithmetic and conversion slots for owned subclasses", () => {
  const state = fixture(); state.globals.set("Int",state.registry.integerType());
  state.run("class Child(Int):\n pass\nx=Child(7)\ncorrect=x+2==9 and 2+x==9 and x*3==21 and 3*x==21 and x-2==5 and 20//x==2 and x%3==1 and (x<<2)==28 and -x==-7 and +x==7 and ~x==-8 and x>2 and x==7 and x.__bool__() and x.__int__()==7 and x.__index__()==7 and x.__float__()==7.0 and f'{x!r}'=='7'\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("keeps explicit integer bitwise slots integer-valued for boolean receivers", () => {
  const state = fixture();state.globals.set("Int",state.registry.integerType());
  state.run("correct=type(Int.__and__(True,True)) is Int and type(Int.__or__(False,True)) is Int and type(Int.__xor__(True,True)) is Int\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("bypasses owned integer index overrides when consuming integer payloads", () => {
  const state = fixture(); state.globals.set("Int",state.registry.integerType());state.globals.set("Range",state.registry.rangeType());
  state.run("class Child(Int):\n def __index__(self):\n  visit('wrong')\n  return 0\n def __int__(self):\n  visit('int')\n  return 9\nx=Child(3)\ncorrect=Range(x).stop==3 and [1,2,3,4][x]==4 and Int(x)==9\n");
  expect(state.globals.get("correct")).toBe(state.v.true);expect(state.events).toEqual(["int"]);
});

it("constructs integers from exact values, floats and explicit-base text", () => {
  const state = fixture();
  state.builtins.set("Int",state.v.builtinFunction({name:"int",invoke(args,keywords,meter,invocation){return constructRuntimeInteger(args,keywords,state.v,meter,{invocation});}}));
  state.run("x=10**30\ncorrect=Int(x) is x and Int()==0 and Int(True)==1 and Int(-2.9)==-2 and Int(' ١٢٣ ')==123 and Int('0x_ff',base=0)==255 and Int(b'11',2)==3\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(() => state.run("Int(base=1)\n")).toThrow("int() missing string argument");
  expect(() => state.run("Int(None,1)\n")).toThrow("int() base must be >= 2 and <= 36, or 0");
});

it("prefers guest int conversion over index and ignores trunc conversion", () => {
  const state = fixture();
  state.builtins.set("Int",state.v.builtinFunction({name:"int",invoke(args,keywords,meter,invocation){return constructRuntimeInteger(args,keywords,state.v,meter,{invocation});}}));
  state.run("x=10**30\nclass Both:\n def __int__(self):\n  visit('int')\n  return x\n def __index__(self):\n  visit('wrong')\n  return 2\nclass Index:\n def __index__(self):\n  visit('index')\n  return x\nclass Trunc:\n def __trunc__(self):\n  visit('wrong')\n  return 1\ncorrect=Int(Both()) is x and Int(Index()) is x\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(() => state.run("Int(Trunc())\n")).toThrow("int() argument must be a string, a bytes-like object or a real number, not 'Trunc'");
  expect(state.events).toEqual(["int","index"]);
});

it("constructs canonical ranges through ordered index conversion", () => {
  const state = fixture(); state.globals.set("Range", state.registry.rangeType());
  state.run("class Index:\n def __init__(self,name,value):\n  self.name=name\n  self.value=value\n def __index__(self):\n  visit(self.name)\n  return self.value\nr=Range(Index('start',1),Index('stop',8),Index('step',2))\ncorrect=type(r) is Range and (r.start,r.stop,r.step)==(1,8,2) and Range.__new__.__self__ is Range\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(state.events).toEqual(["start","stop","step"]);
  expect(() => state.run("Range(**{1:2})\n")).toThrow("keywords must be strings");
  expect(() => state.run("Range.__new__(Range,**{1:2})\n")).toThrow("range() takes no keyword arguments");
  expect(() => state.run("Range(1,2,0)\n")).toThrow("range() arg 3 must not be zero");
  expect(() => state.run("r.start=4\n")).toThrow("readonly attribute");
});

it("retains exact range component identities through construction and reduction", () => {
  const state = fixture(); state.globals.set("Range", state.registry.rangeType());
  state.run("x=10**30\ny=x+9\nz=10**20\nr=Range(x,y,z)\nparts=r.__reduce__()[1]\ncorrect=r.start is x and r.stop is y and r.step is z and r.start is r.start and parts[0] is x and parts[1] is y and parts[2] is z\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("retains exact integers returned by range index conversion and normalizes booleans", () => {
  const state = fixture(); state.globals.set("Range", state.registry.rangeType());
  state.run("x=10**30\nclass Index:\n def __index__(self):\n  visit('index')\n  return x\nr=Range(Index())\nb=Range(False,True,True)\ns=r[::2]\ncorrect=r.stop is x and b.start is not False and b.stop is not True and b.step is not True and (b.start,b.stop,b.step)==(0,1,1) and s.stop is s.stop and s.__reduce__()[1][1] is s.stop\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(state.events).toEqual(["index"]);
});

it("publishes range protocol descriptors without materializing large ranges", () => {
  const state = fixture(); state.globals.set("Range", state.registry.rangeType());
  state.run("r=Range(0,10**30,2)\ncorrect=Range.__bool__(r) and Range.__getitem__(r,-1)==10**30-2 and Range.__contains__(r,10**29) and r.count(10**29)==1 and r.index(10**29)==5*10**28 and Range.__eq__(Range(0),Range(1,1)) and r.__reduce__()[0] is Range and r.__reduce__()[1]==(0,10**30,2)\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(() => state.run("Range.__len__(r)\n")).toThrow("Python int too large to convert to C ssize_t");
});

it("searches ranges through reflected guest equality rather than index conversion", () => {
  const state = fixture(); state.globals.set("r",state.v.range({start:0n,stop:4n,step:1n,length:4n}));
  state.run("class Needle:\n def __index__(self):\n  visit('index')\n  return 0\n def __eq__(self,other):\n  visit('eq')\n  return other==2\nn=Needle()\ncorrect=r.count(n)==1 and r.index(n)==2\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(state.events).toEqual(Array(7).fill("eq"));
});

it("publishes retained mapping proxy read-method descriptors", () => {
  const state = fixture(); state.globals.set("Proxy", state.registry.mappingProxyType());
  state.run("d={'a':1}\np=Proxy(d)\nget=p.get\nd['a']=2\ncorrect=get.__self__ is p and Proxy.get.__objclass__ is Proxy and get('a')==2 and Proxy.get(p,'missing',3)==3 and Proxy.copy(p)==d and Proxy.keys(p).mapping==p\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("publishes mapping proxy protocol wrappers over live mappings", () => {
  const state = fixture(); state.globals.set("Proxy", state.registry.mappingProxyType());
  state.run("d={'a':1}\np=Proxy(d)\ncorrect=Proxy.__len__(p)==1 and Proxy.__getitem__(p,'a')==1 and Proxy.__contains__(p,'a') and Proxy.__eq__(p,d) and Proxy.__or__(p,{'b':2})=={'a':1,'b':2} and Proxy.__ror__(p,{'a':2})=={'a':1} and Proxy.__str__(p)==f'{d}' and Proxy.__repr__(p)==f'mappingproxy({d!r})'\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(() => state.run("Proxy.__ior__(p,{})\n")).toThrow("'|=' is not supported by mappingproxy; use '|' instead");
  expect(() => state.run("p.__hash__()\n")).toThrow("unhashable type: 'dict'");
});

it("delegates explicit mapping proxy slots to guest mapping protocols", () => {
  const state = fixture(); state.globals.set("Proxy", state.registry.mappingProxyType());
  state.run("class Mapping:\n def __getitem__(self,key):\n  visit('item')\n  return key\n def __len__(self):\n  visit('len')\n  return 4\n def __contains__(self,key):\n  visit('contains')\n  return True\n def __eq__(self,other):\n  visit('eq')\n  return 7\n def __hash__(self):\n  visit('hash')\n  return 9\np=Proxy(Mapping())\ncorrect=Proxy.__getitem__(p,'x')=='x' and Proxy.__len__(p)==4 and Proxy.__contains__(p,3) and Proxy.__eq__(p,3)==7 and Proxy.__hash__(p)==9\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(state.events).toEqual(["item","len","contains","eq","hash"]);
});

it("constructs canonical slices without coercing components", () => {
  const state = fixture(); state.globals.set("Slice", state.registry.sliceType());
  state.run("class Component:\n def __index__(self):\n  visit('index')\n  return 1\npart=Component()\na=Slice(part)\nb=Slice(part,2)\nc=Slice(part,2,0)\ncorrect=type(a) is Slice and a.start is None and a.stop is part and a.step is None and b.start is part and b.stop==2 and c.step==0 and Slice.__new__.__self__ is Slice\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.events).toEqual([]);
  expect(() => state.run("Slice()\n")).toThrow("slice expected at least 1 argument, got 0");
  expect(() => state.run("Slice(1,2,3,4)\n")).toThrow("slice expected at most 3 arguments, got 4");
  expect(() => state.run("Slice(**{1:2})\n")).toThrow("slice() takes no keyword arguments");
  expect(() => state.run("class Child(Slice):\n pass\n")).toThrow("type 'slice' is not an acceptable base type");
});

it("publishes read-only slice component members", () => {
  const state = fixture(); state.globals.set("Slice", state.registry.sliceType());
  state.run("s=Slice(1,2,3)\ncorrect=Slice.start.__get__(s)==1 and Slice.stop.__get__(s)==2 and Slice.step.__get__(s)==3 and Slice.start.__objclass__ is Slice\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(() => state.run("s.start=4\n")).toThrow("readonly attribute");
  expect(() => state.run("del s.stop\n")).toThrow("readonly attribute");
  expect(() => state.run("Slice.step.__set__(s,4)\n")).toThrow("readonly attribute");
  expect(() => state.run("object.__setattr__(s,'start',4)\n")).toThrow("readonly attribute");
  expect(() => state.run("object.__delattr__(s,'stop')\n")).toThrow("readonly attribute");
});

it("normalizes slice indices with arbitrary precision and ordered guest coercion", () => {
  const state = fixture(); state.globals.set("Slice", state.registry.sliceType());
  state.run("class Index:\n def __init__(self,name,value):\n  self.name=name\n  self.value=value\n def __index__(self):\n  visit(self.name)\n  return self.value\ns=Slice(Index('start',-9),Index('stop',99),Index('step',2))\nresult=s.indices(Index('length',10))\nlarge=Slice(None,None,-1).indices(10**30)\n");
  expect(state.globals.get("result")).toEqual(state.v.tuple([state.v.integer(1),state.v.integer(10),state.v.integer(2)]));
  expect(state.globals.get("large")).toEqual(state.v.tuple([state.v.integer(10n**30n-1n),state.v.integer(-1),state.v.integer(-1)]));
  expect(state.events).toEqual(["length","step","start","stop"]);
  expect(() => state.run("s.indices(-1)\n")).toThrow("length should not be negative");
  expect(state.events).toEqual(["length","step","start","stop"]);
});

it("publishes slice comparison, hash and reduction descriptors", () => {
  const state = fixture(); state.globals.set("Slice", state.registry.sliceType());
  state.builtins.set("hash",createHashBuiltin(state.v,state.meter,state.hash));
  state.run("s=Slice(1,4,2)\nr=s.__reduce__()\ncorrect=Slice.__eq__(s,Slice(1,4,2)) and Slice.__lt__(s,Slice(2,4,2)) and s.__hash__()==hash(s) and r[0] is Slice and r[1]==(1,4,2) and Slice.indices.__objclass__ is Slice\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("represents slices using guest repr slots in component order", () => {
  const state = fixture();
  state.run("class Capture:\n def __getitem__(self,key):\n  return key\nclass Component:\n def __repr__(self):\n  visit('repr')\n  return 'part'\n def __str__(self):\n  visit('str')\n  return 'wrong'\ns=Capture()[Component():Component():Component()]\ntext=f'{s!r}'\nplain=f'{s!s}'\nexplicit=s.__repr__()\n");
  for (const name of ["text", "plain", "explicit"]) expect(state.globals.get(name)).toEqual(state.v.string("slice(part, part, part)"));
  expect(state.events).toEqual(Array(9).fill("repr"));
});

it("retains container recursion markers inside slice representations", () => {
  const state = fixture();
  state.run("class Capture:\n def __getitem__(self,key):\n  return key\nitems=[]\ns=Capture()[:items:]\nitems.append(s)\ntext=f'{s!r}'\n");
  expect(state.globals.get("text")).toEqual(state.v.string("slice(None, [slice(None, [...], None)], None)"));
});

it("represents deeply nested slices without host recursion", () => {
  const state = fixture(undefined, 1000000);
  let slice: RuntimeValue = state.v.none;
  for (let index = 0; index < 1000; index++) slice = state.v.slice({ upper: slice });
  state.globals.set("s", slice); state.run("text=f'{s!r}'\n");
  const text = state.globals.get("text"); if (text?.kind !== "str") throw Error("expected slice representation");
  expect(text.value.length).toBe(19004);
});

it("forwards deeply nested mapping proxies without host recursion", () => {
  const state = fixture(undefined, 1000000); state.run("d={'a':1}\n");
  let proxy = state.globals.get("d")!;
  for (let index = 0; index < 5000; index++) proxy = state.v.mappingProxy(proxy);
  state.globals.set("p", proxy);
  state.run("value=p['a']\ntruth=not not p\ncorrect=value==1 and truth\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  state.run("text=f'{p!r}'\nplain=f'{p!s}'\n");
  const text = state.globals.get("text"); if (text?.kind !== "str") throw Error("expected proxy representation");
  expect(text.value.length).toBe(70008); expect(state.globals.get("plain")).toEqual(state.v.string("{'a': 1}"));
});

it("constructs live mapping proxies over arbitrary guest mappings", () => {
  const state = fixture();
  state.run("Proxy=type({}.keys().mapping)\nList=type([])\nclass Mapping:\n def __getitem__(self,key):\n  visit(key)\n  return 7\n def keys(self):\n  visit('keys')\n  return ['x']\n def __iter__(self):\n  visit('iter')\n  return ['x'].__iter__()\n def __len__(self):\n  visit('len')\n  return 1\n def __contains__(self,key):\n  visit('contains')\n  return True\nm=Mapping()\np=Proxy(mapping=m)\nvalue=p['x']\nentries=List(p)\nexpanded={**p}\nfound='missing' in p\ncorrect=value==7 and entries==['x'] and expanded=={'x':7} and found and type(p) is Proxy\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.events).toEqual(["x", "iter", "len", "keys", "x", "contains"]);
});

it("constructs mapping proxies over native subscriptable values and nested proxies", () => {
  const state = fixture();
  state.run("Proxy=type({}.keys().mapping)\nList=type([])\nd={'a':1}\np=Proxy(d)\nnested=Proxy(p)\nd['a']=2\ntext=Proxy('ab')\nbytes=Proxy(b'ab')\ncorrect=nested['a']==2 and text[1]=='b' and bytes[0]==97 and List(text)==['a','b'] and 'a' in text and not not text\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("checks mapping proxy applicability without binding item descriptors", () => {
  const state = fixture();
  state.run("Proxy=type({}.keys().mapping)\nclass Descriptor:\n def __get__(self,instance,owner):\n  visit('get')\n  return None\nclass Mapping:\n __getitem__=Descriptor()\np=Proxy(Mapping())\nclass Empty:\n __getitem__=None\nother=Proxy(Empty())\n");
  expect(state.events).toEqual([]);
  expect(() => state.run("Proxy([])\n")).toThrow("mappingproxy() argument must be a mapping, not list");
  expect(() => state.run("Proxy()\n")).toThrow("mappingproxy() missing required argument 'mapping' (pos 1)");
  expect(() => state.run("Proxy({},mapping={})\n")).toThrow("mappingproxy() takes at most 1 argument (2 given)");
});

it.each(["keys", "values", "items"] as const)("publishes canonical dictionary %s view protocols and allocation boundaries", method => {
  const state = fixture();
  state.run(`List=type([])\nd={'a':1}\nv=d.${method}()\nView=type(v)\nlength=View.__len__(v)\nentries=List(View.__iter__(v))\nreverse=List(View.__reversed__(v))\ntext=View.__repr__(v)\nbound=v.__iter__.__self__ is v\nowner=View.__iter__.__objclass__ is View\nmethodOwner=View.__reversed__.__objclass__ is View\nproxy=View.mapping.__get__(v)\ncorrect=length==1 and entries==reverse and bound and owner and methodOwner and proxy==d\n`);
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(state.globals.get("text")).toEqual(state.v.string(`dict_${method}(${method === "keys" ? "['a']" : method === "values" ? "[1]" : "[('a', 1)]"})`));
  expect(() => state.run("View()\n")).toThrow(`cannot create 'dict_${method}' instances`);
  expect(() => state.run("object.__new__(View)\n")).toThrow(`cannot create 'dict_${method}' instances`);
  expect(() => state.run("class Child(View):\n pass\n")).toThrow(`type 'dict_${method}' is not an acceptable base type`);
  expect(() => state.run("View.extra=1\n")).toThrow("immutable type");
});

it.each(["keys", "items"] as const)("publishes dictionary %s view comparison and algebra descriptors", method => {
  const state = fixture(); state.globals.set("NotImplemented", state.v.notImplemented);
  state.run(`d={'a':1}\nv=d.${method}()\nView=type(v)\nother=${method === "keys" ? "{'a'}" : "{('a',1)}"}\ncorrect=View.__eq__(v,other) and View.__le__(v,other) and not View.__lt__(v,other) and View.__eq__(v,[]) is NotImplemented and View.__or__(v,[])==other and View.__rsub__(v,[])==type(other)() and v.isdisjoint([]) and View.__hash__ is None\n`);
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it.each(["object", "type", "list", "tuple", "dict", "set", "frozenset"] as const)("retains the defining owner on %s allocation functions", kind => {
  const state = fixture();
  const base = kind === "object" ? state.registry.object : kind === "type" ? state.registry.type : kind === "list" ? state.registry.listType() : kind === "tuple" ? state.registry.tupleType() : kind === "dict" ? state.registry.dictionaryType() : state.registry.setType(kind);
  state.globals.set("Base", base);
  state.run("class Child(Base):\n pass\nallocator=Base.__new__\ncorrect=allocator.__self__ is Base and allocator.__name__=='__new__' and allocator.__module__ is None and Child.__new__ is allocator\nqualified=allocator.__qualname__\ntext=f'{allocator!r}'\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.globals.get("qualified")).toEqual(state.v.string(`${kind}.__new__`));
  expect(state.globals.get("text")).toEqual(state.v.string(`<built-in method __new__ of type object at 0x${state.v.identity.id(base).toString(16)}>`));
  expect(() => state.run("allocator(x=1,**{'x':2})\n")).toThrow(`${kind}.__new__() got multiple values for keyword argument 'x'`);
  if (kind !== "type") {
    state.run("allocated=allocator(Child)\ncorrect=type(allocated) is Child\n");
    expect(state.globals.get("correct")).toBe(state.v.true);
  }
});

it("lets exact object construction reject keyword dictionaries itself", () => {
  const state = fixture();
  expect(() => state.run("object(**{1:2})\n")).toThrow("object() takes no arguments");
});

it("lets list subclasses with custom allocators consume initialization keywords", () => {
  const state = fixture();
  state.run("List=type([])\nclass Child(List):\n def __new__(cls,*args,**kw):\n  visit('new')\n  return List.__new__(cls)\nclass Source:\n def __iter__(self):\n  visit('iter')\n  return [1].__iter__()\nitems=Child(Source(),extra=2)\ncorrect=items==[1]\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.events).toEqual(["new", "iter"]);
  state.run("class Alias(List):\n __new__=List.__new__\n");
  expect(() => state.run("Alias(extra=2)\n")).toThrow("list() takes no keyword arguments");
});

it.each(["list", "set", "tuple", "frozenset", "object"] as const)("lets the %s allocator own keyword validation", kind => {
  const state = fixture();
  state.globals.set("Base", kind === "object" ? state.registry.object : kind === "list" ? state.registry.listType() : kind === "tuple" ? state.registry.tupleType() : state.registry.setType(kind));
  state.run("class Child(Base):\n def __init__(self,**kw):\n  visit('init')\nallocated=Base.__new__(Child,**{1:2})\ncorrect=type(allocated) is Child\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.events).toEqual([]);
  if (kind === "list" || kind === "set") {
    state.run("exact=Base.__new__(Base,**{1:2})\ncorrect=type(exact) is Base\n");
    expect(state.globals.get("correct")).toBe(state.v.true);
  } else expect(() => state.run("Base.__new__(Base,**{1:2})\n")).toThrow(kind === "object" ? "object() takes no arguments" : `${kind}() takes no keyword arguments`);
});

it.each(["tuple", "frozenset"] as const)("consumes %s allocation input before guest initializer keyword errors", kind => {
  const state = fixture(); state.globals.set("Base", kind === "tuple" ? state.registry.tupleType() : state.registry.setType(kind));
  state.run("class Child(Base):\n def __init__(self,*args,**kw):\n  visit('init')\nclass Source:\n def __iter__(self):\n  visit('iter')\n  return [].__iter__()\n");
  expect(() => state.run("Child(Source(),**{1:2})\n")).toThrow("keywords must be strings");
  expect(state.events).toEqual(["iter"]);
});

it.each(["list", "tuple", "set", "frozenset"] as const)("uses native %s comparison after subclass slots decline", kind => {
  const state = fixture(); state.globals.set("NotImplemented", state.v.notImplemented);
  state.globals.set("Base", kind === "list" ? state.registry.listType() : kind === "tuple" ? state.registry.tupleType() : state.registry.setType(kind));
  state.run("class Child(Base):\n def __eq__(self,other):\n  visit('eq')\n  return NotImplemented\n def __ne__(self,other):\n  visit('ne')\n  return NotImplemented\n def __lt__(self,other):\n  visit('lt')\n  return NotImplemented\n def __le__(self,other):\n  visit('le')\n  return NotImplemented\n def __gt__(self,other):\n  visit('gt')\n  return NotImplemented\n def __ge__(self,other):\n  visit('ge')\n  return NotImplemented\na=Child([1])\nb=Base([1])\nresults=(a==b,b==a,a!=b,b!=a,a<b,b<a,a<=b,b<=a,a>b,b>a,a>=b,b>=a)\ncorrect=results==(True,True,False,False,False,False,True,True,False,False,True,True)\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
  expect(state.events).toEqual(["eq", "eq", "ne", "ne", "lt", "gt", "le", "ge", "gt", "lt", "ge", "le"]);
});

it.each(["d", "Dict.keys(d).mapping", "Dict.values(d).mapping", "Dict.items(d).mapping"])("falls back to native dictionary comparison after declined subclass slots through %s", expression => {
  const state = fixture(); state.globals.set("NotImplemented", state.v.notImplemented);
  state.run(`Dict=type({})\nclass Child(Dict):\n def __eq__(self,other):\n  visit('equal')\n  return NotImplemented\n def __ne__(self,other):\n  visit('different')\n  return NotImplemented\nd=Child(a=1)\np=${expression}\nforward=p=={'a':1}\nreverse={'a':1}==p\nunequal=p!={'a':1}\nreverseUnequal={'a':1}!=p\n`);
  expect(state.globals.get("forward")).toBe(state.v.true); expect(state.globals.get("reverse")).toBe(state.v.true);
  expect(state.globals.get("unequal")).toBe(state.v.false); expect(state.globals.get("reverseUnequal")).toBe(state.v.false);
  expect(state.events).toEqual(["equal", "equal", "different", "different"]);
});

it("expands subclass mapping proxies through live keys and item overrides", () => {
  const state = fixture();
  state.run("Dict=type({})\nclass Child(Dict):\n def keys(self):\n  visit('keys')\n  return ['x']\n def __getitem__(self,key):\n  visit(key)\n  return 9\nd=Child(a=1)\np=Dict.items(d).mapping\nliteral={**p}\nconstructed=Dict(p)\ndef accept(**kw):\n return kw\ncalled=accept(**p)\ncorrect=literal=={'x':9} and constructed==literal and called==literal\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.events).toEqual(["keys", "x", "keys", "x", "keys", "x"]);
});

it("delegates mapping proxy representation, comparisons and union to the owner", () => {
  const state = fixture();
  state.run("Dict=type({})\nclass Child(Dict):\n def __repr__(self):\n  visit('repr')\n  return 'child'\n def __str__(self):\n  visit('str')\n  return 'text'\n def __eq__(self,other):\n  visit('equal')\n  return 7\n def __or__(self,other):\n  visit('forward')\n  return 8\n def __ror__(self,other):\n  visit('reverse')\n  return 9\nd=Child()\np=Dict.values(d).mapping\nrepresentation=f'{p!r}'\ntext=f'{p!s}'\nequal=p=={}\nforward=p|{}\nreverse={}|p\n");
  expect(state.globals.get("representation")).toEqual(state.v.string("mappingproxy(child)")); expect(state.globals.get("text")).toEqual(state.v.string("text"));
  expect(state.globals.get("equal")).toEqual(state.v.integer(7)); expect(state.globals.get("forward")).toEqual(state.v.integer(8)); expect(state.globals.get("reverse")).toEqual(state.v.integer(9));
  expect(state.events).toEqual(["repr", "str", "equal", "forward", "reverse"]);
});

it("reverses mapping proxies through the owner's ordinary reversed attribute", () => {
  const state = fixture(); state.builtins.set("reversed", createReversedBuiltin(state.v, state.meter));
  state.run("Dict=type({})\nList=type([])\nclass Child(Dict):\n def __reversed__(self):\n  visit('reverse')\n  return ['x'].__iter__()\nd=Child(a=1)\np=Dict.keys(d).mapping\nresult=List(reversed(p))\ncorrect=result==['x']\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.events).toEqual(["reverse"]);
});

it("does not inherit an underlying dictionary's length hint through its proxy", () => {
  const state = fixture();
  state.run("Dict=type({})\nList=type([])\nclass Child(Dict):\n def __len__(self):\n  visit('len')\n  return 'invalid'\n def __length_hint__(self):\n  visit('hint')\n  return 1\nd=Child(a=1)\np=Dict.keys(d).mapping\nresult=List(p)\ncorrect=result==['a']\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.events).toEqual(["len"]);
});

it("retains dictionary subclass ownership behind native views and mapping proxies", () => {
  const state = fixture();
  state.run("Dict=type({})\nList=type([])\nclass Child(Dict):\n def __getitem__(self,key):\n  visit('get')\n  return 9\n def __iter__(self):\n  visit('iter')\n  return ['x'].__iter__()\n def keys(self):\n  visit('keys')\n  return ['y']\nd=Child(a=1)\nview=Dict.keys(d)\np=view.mapping\nentries=List(view)\nvalue=p['a']\niterator=p.__reversed__()\nkeys=p.keys()\ncopy=p.copy()\ncorrect=entries==['a'] and value==9 and keys==['y'] and copy=={'y':9}\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.events).toEqual(["get", "keys", "keys", "get"]);
});

it("delegates proxy iteration, membership and truth while views retain native entries", () => {
  const state = fixture();
  state.run("Dict=type({})\nList=type([])\nclass Child(Dict):\n def __len__(self):\n  visit('len')\n  return 0\n def __bool__(self):\n  visit('bool')\n  return True\n def __iter__(self):\n  visit('iter')\n  return ['x'].__iter__()\n def __contains__(self,key):\n  visit('contains')\n  return True\nd=Child(a=1)\nv=Dict.keys(d)\np=v.mapping\nitems=List(p)\nfound='z' in p\ntruth=not not p\nviewtruth=not not v\ncorrect=items==['x'] and found and not truth and viewtruth\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.events).toEqual(["iter", "len", "contains", "len"]);
});

it("retains dictionary subclass source effects before invalid constructor keywords", () => {
  const state = fixture();
  state.run("Dict=type({})\nclass Child(Dict):\n pass\nclass Mapping:\n def keys(self):\n  visit('keys')\n  return ['a']\n def __getitem__(self,key):\n  visit(key)\n  return 7\n");
  expect(() => state.run("Child(Mapping(),**{1:2})\n")).toThrow("keywords must be strings");
  expect(state.events).toEqual(["keys", "a"]);
});

it("keeps overridden attribute lookup and instance shadows on bound method calls", () => {
  const state = fixture();
  state.run("Dict=type({})\nclass Child(Dict):\n def __getattribute__(self,name):\n  return object.__getattribute__(self,name)\nd=Child()\nclass Plain(Dict):\n pass\np=Plain()\np.copy=p.copy\n");
  expect(() => state.run("d.copy(1)\n")).toThrow("Child.copy() takes no arguments (1 given)");
  expect(() => state.run("p.copy(1)\n")).toThrow("Plain.copy() takes no arguments (1 given)");
});

it("bypasses mapping overrides when copying a dictionary with the native iterator", () => {
  const state = fixture();
  state.run("Dict=type({})\nclass Child(Dict):\n def keys(self):\n  visit('keys')\n  return ['x']\n def __getitem__(self,key):\n  visit('get')\n  return 8\nd=Child(a=1)\na=Dict(d)\nb=d.copy()\nc=d|{}\ne={}\ne.update(d)\ncorrect=a=={'a':1} and b==a and c==a and e==a\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.events).toEqual([]);
});

it("constructs fromkeys on owned dictionary subclasses through their setters", () => {
  const state = fixture();
  state.run("Dict=type({})\nclass Child(Dict):\n __slots__=()\n def __setitem__(self,key,value):\n  visit(key)\n  Dict.__setitem__(self,key,value)\nd=Child.fromkeys(['a','a','b'],7)\ncorrect=type(d) is Child and d=={'a':7,'b':7}\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.events).toEqual(["a", "a", "b"]);
  expect(() => state.run("d.extra=1\n")).toThrow("has no attribute 'extra'");
});

it("preserves direct versus stored native dictionary method diagnostics", () => {
  const state = fixture(); state.run("Dict=type({})\nclass Child(Dict):\n pass\nd=Child()\nstored=d.copy\n");
  expect(() => state.run("d.copy(1)\n")).toThrow("dict.copy() takes no arguments (1 given)");
  expect(() => state.run("stored(1)\n")).toThrow("Child.copy() takes no arguments (1 given)");
  expect(() => state.run("d.copy(*(1,))\n")).toThrow("Child.copy() takes no arguments (1 given)");
  expect(() => state.run("Dict.copy(d,1)\n")).toThrow("dict.copy() takes no arguments (1 given)");
});

it.each(["Dict(d)", "d.copy()", "d|{}", "{}|d"])("observes overridden dictionary iteration slots when copying with %s", expression => {
  const state = fixture();
  state.run(`Dict=type({})\nclass Child(Dict):\n def __iter__(self):\n  visit('iter')\n  return ['x'].__iter__()\n def keys(self):\n  visit('keys')\n  return ['x']\n def __getitem__(self,key):\n  visit('get')\n  return 8\nd=Child(a=1)\nresult=${expression}\ncorrect=result=={'x':8}\n`);
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.events).toEqual(["keys", "get"]);
});

it("allocates owned dictionary subclasses with native protocols and instance attributes", () => {
  const state = fixture();
  state.run("Dict=type({})\nList=type([])\nclass Child(Dict):\n pass\nd=Child(a=1)\nd.label='owned'\nd['b']=2\nsize=d.__len__()\nkeys=List(d)\nvalue=d.get('a')\nd.setdefault('c',3)\npopped=d.pop('c')\ntext=f'{d!r}'\ncopy=d.copy()\ncorrect=type(d) is Child and d.label=='owned' and size==2 and keys==['a','b'] and value==1 and popped==3 and d=={'a':1,'b':2} and type(copy) is Dict\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.globals.get("text")).toEqual(state.v.string("{'a': 1, 'b': 2}"));
});

it("dispatches dictionary missing hooks only for item retrieval", () => {
  const state = fixture();
  state.run("Dict=type({})\nclass Child(Dict):\n def __missing__(self,key):\n  visit(key)\n  return 7\nd=Child()\nfirst=d['a']\nsecond=Dict.__getitem__(d,'b')\nmissing=d.get('c')\nfound='c' in d\ncorrect=first==7 and second==7 and missing is None and not found\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.events).toEqual(["a", "b"]);
});

it("preserves owned dictionary in-place union identity and ordinary union reflection", () => {
  const state = fixture(); state.globals.set("NotImplemented", state.v.notImplemented);
  state.run("Dict=type({})\nclass Child(Dict):\n def __ror__(self,other):\n  visit('reverse')\n  return NotImplemented\nd=Child(a=1)\noriginal=d\nd|={'b':2}\ncombined={'a':3}|d\ncorrect=d is original and d=={'a':1,'b':2} and combined=={'a':1,'b':2} and type(combined) is Dict\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.events).toEqual(["reverse"]);
});

it("binds canonical dictionary fromkeys to the defining class", () => {
  const state = fixture();
  state.run("Dict=type({})\nd={'old':1}\nshared=[]\nresult=Dict.fromkeys(['a','b','a'],shared)\nbound=d.fromkeys.__self__ is Dict\nclassbound=Dict.fromkeys.__self__ is Dict\ncorrect=bound and classbound and result['a'] is shared and result['b'] is shared and d=={'old':1}\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("constructs fromkeys results before source iteration and uses guest item assignment", () => {
  const state = fixture();
  state.run("Dict=type({})\nclass Target:\n def __setitem__(self,key,value):\n  visit(key)\nclass Child(Dict):\n def __new__(cls):\n  visit('new')\n  return Target()\nclass Source:\n def __getitem__(self,index):\n  visit('next')\n  return ('a','a','b')[index]\nresult=Child.fromkeys(Source(),7)\ncorrect=type(result) is Target\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.events).toEqual(["new", "next", "a", "next", "a", "next", "b", "next"]);
});

it("validates fromkeys arguments before invoking the bound class", () => {
  const state = fixture();
  state.run("Dict=type({})\nclass Child(Dict):\n def __new__(cls):\n  visit('new')\n  return {}\n");
  expect(() => state.run("Child.fromkeys()\n")).toThrow("fromkeys expected at least 1 argument, got 0");
  expect(() => state.run("Child.fromkeys([],value=1)\n")).toThrow("Child.fromkeys() takes no keyword arguments");
  expect(state.events).toEqual([]);
});

it("constructs exact dictionaries from positional sources and keyword overrides", () => {
  const state = fixture();
  state.run("Dict=type({})\nsource={'a':1}\nd=Dict(source,a=2,b=3)\nempty=Dict()\ncorrect=d=={'a':2,'b':3} and source=={'a':1} and d is not source and empty=={} and type(d) is Dict\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("allocates empty dictionaries without consuming initialization arguments", () => {
  const state = fixture();
  state.run("Dict=type({})\nclass Source:\n def keys(self):\n  visit('keys')\n  return []\nd=Dict.__new__(Dict,Source(),1,**{1:2})\ncorrect=d=={} and type(d) is Dict\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.events).toEqual([]);
});

it("reinitializes dictionaries by merging rather than clearing their entries", () => {
  const state = fixture();
  state.run("Dict=type({})\nd={'a':1}\nempty=Dict.__init__(d)\nresult=Dict.__init__(d,[('b',2)],a=3)\ncorrect=empty is None and result is None and d=={'a':3,'b':2}\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("preserves positional dictionary initialization before invalid keyword names", () => {
  const state = fixture(); state.run("Dict=type({})\nd={'old':1}\n");
  expect(() => state.run("Dict.__init__(d,{'a':2},**{1:3})\n")).toThrow("keywords must be strings");
  state.run("correct=d=={'old':1,'a':2}\n"); expect(state.globals.get("correct")).toBe(state.v.true);
});

it("publishes dictionary union wrappers with native operand orientation", () => {
  const state = fixture(); state.globals.set("NotImplemented", state.v.notImplemented);
  state.run("Dict=type({})\nleft={'a':1,'b':2}\nright={'b':3,'c':4}\nforward=Dict.__or__(left,right)\nreverse=Dict.__ror__(left,right)\ndeclined=Dict.__or__(left,[]) is NotImplemented\nbound=left.__or__.__self__ is left\ncorrect=forward=={'a':1,'b':3,'c':4} and reverse=={'b':2,'c':4,'a':1} and forward is not left and reverse is not left and left=={'a':1,'b':2} and declined and bound\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("retains dictionary in-place union identity and active guest mapping protocols", () => {
  const state = fixture();
  state.run("Dict=type({})\nclass Mapping:\n def keys(self):\n  visit('keys')\n  return ['a']\n def __getitem__(self,key):\n  visit(key)\n  return 7\nd={}\nresult=Dict.__ior__(d,Mapping())\ncorrect=result is d and d=={'a':7}\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.events).toEqual(["keys", "a"]);
});

it("retains partial writes from dictionary in-place union pair errors", () => {
  const state = fixture(); state.run("Dict=type({})\nd={}\n");
  expect(() => state.run("Dict.__ior__(d,[('a',1),('b',2,3)])\n")).toThrow("dictionary update sequence element #1 has length 3; 2 is required");
  state.run("correct=d=={'a':1}\n"); expect(state.globals.get("correct")).toBe(state.v.true);
});

it.each(["Dict.__len__(d,**{1:2})", "d.__len__(**{1:2})"])("lets native wrappers reject keyword dictionaries in %s", expression => {
  const state = fixture(); state.run("Dict=type({})\nd={}\n");
  expect(() => state.run(expression + "\n")).toThrow("wrapper __len__() takes no keyword arguments");
});

it("publishes canonical dictionary indexing and iteration protocols", () => {
  const state = fixture();
  state.run("Dict=type({})\nList=type([])\nd={}\nwritten=Dict.__setitem__(d,'a',1)\nDict.__setitem__(d,'b',2)\nsize=Dict.__len__(d)\nfound=Dict.__contains__(d,'a')\nvalue=Dict.__getitem__(d,'a')\nkeys=List(Dict.__iter__(d))\ndeleted=Dict.__delitem__(d,'a')\nbound=d.__getitem__.__self__ is d\nowner=Dict.__getitem__.__objclass__ is Dict\ncorrect=written is None and deleted is None and size==2 and found and value==1 and keys==['a','b'] and d=={'b':2} and bound and owner\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("uses active guest representations and recursion guards in explicit dict repr", () => {
  const state = fixture();
  state.run("Dict=type({})\nclass Value:\n def __repr__(self):\n  visit('repr')\n  return 'value'\nd={'a':Value()}\ntext=Dict.__repr__(d)\nd['self']=d\nrecursive=d.__repr__()\n");
  expect(state.globals.get("text")).toEqual(state.v.string("{'a': value}"));
  expect(state.globals.get("recursive")).toEqual(state.v.string("{'a': value, 'self': {...}}"));
  expect(state.events).toEqual(["repr", "repr"]);
});

it("publishes dictionary equality with guest member comparisons and disabled hashing", () => {
  const state = fixture(); state.globals.set("NotImplemented", state.v.notImplemented);
  state.run("Dict=type({})\nclass Value:\n def __eq__(self,other):\n  visit('equal')\n  return True\nleft={'a':Value()}\nright={'a':Value()}\nequal=Dict.__eq__(left,right)\ndifferent=Dict.__ne__(left,right)\ndeclined=Dict.__eq__(left,[]) is NotImplemented\nunhashable=Dict.__hash__ is None and left.__hash__ is None\n");
  expect(state.globals.get("equal")).toBe(state.v.true); expect(state.globals.get("different")).toBe(state.v.false);
  expect(state.globals.get("declined")).toBe(state.v.true); expect(state.globals.get("unhashable")).toBe(state.v.true);
  expect(state.events).toEqual(["equal", "equal"]);
});

it("publishes canonical dictionary mutation methods and receiver metadata", () => {
  const state = fixture();
  state.run("Dict=type({})\nd={}\nbound=d.update.__self__ is d\nowner=Dict.update.__objclass__ is Dict\nupdated=Dict.update(d,[('a',1)],b=2)\nexisting=Dict.setdefault(d,'a',9)\ninserted=Dict.setdefault(d,'c',3)\npopped=Dict.pop(d,'b')\nlast=Dict.popitem(d)\ncleared=Dict.clear(d)\ncorrect=bound and owner and updated is None and existing==1 and inserted==3 and popped==2 and last==('c',3) and cleared is None and d=={}\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it.each(["d.update", "Dict.update"])("preserves native keyword validation timing in %s", method => {
  const state = fixture(); state.run("Dict=type({})\nd={}\n");
  expect(() => state.run(`${method}(${method === "Dict.update" ? "d," : ""}{'a':1},**{1:2})\n`)).toThrow("keywords must be strings");
  state.run(`correct=d==${method === "d.update" ? "{'a':1}" : "{}"}\n`); expect(state.globals.get("correct")).toBe(state.v.true);
});

it("retains partial dictionary descriptor updates when pair conversion fails", () => {
  const state = fixture(); state.run("Dict=type({})\nd={}\n");
  expect(() => state.run("Dict.update(d,[('a',1),('b',2,3)])\n")).toThrow("dictionary update sequence element #1 has length 3; 2 is required");
  state.run("correct=d=={'a':1}\n"); expect(state.globals.get("correct")).toBe(state.v.true);
});

it("publishes canonical dictionary read methods with bound receiver metadata", () => {
  const state = fixture();
  state.run("Dict=type({})\nList=type([])\nd={'a':1,'b':2}\nmethod=d.get\nbound=method.__self__ is d\nname=method.__name__\nowner=Dict.get.__objclass__ is Dict\nvalue=Dict.get(d,'a')\ndefault=Dict.get(d,'missing',3)\ncopy=Dict.copy(d)\nfresh=copy is not d\nkeys=List(Dict.keys(d))\nvalues=List(Dict.values(d))\nitems=List(Dict.items(d))\nreverse=List(Dict.__reversed__(d))\n");
  for (const name of ["bound", "owner", "fresh"]) expect(state.globals.get(name)).toBe(state.v.true);
  expect(state.globals.get("name")).toEqual(state.v.string("get"));
  expect(state.globals.get("value")).toEqual(state.v.integer(1)); expect(state.globals.get("default")).toEqual(state.v.integer(3));
  state.run("correct=keys==['a','b'] and values==[1,2] and items==[('a',1),('b',2)] and reverse==['b','a'] and copy==d\n");
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("validates canonical dictionary read method receivers and arguments", () => {
  const state = fixture(); state.run("Dict=type({})\n");
  expect(() => state.run("Dict.get([],1)\n")).toThrow("descriptor 'get' for 'dict' objects doesn't apply to a 'list' object");
  expect(() => state.run("Dict.get({})\n")).toThrow("get expected at least 1 argument, got 0");
  expect(() => state.run("Dict.keys({},1)\n")).toThrow("dict.keys() takes no arguments (1 given)");
});

it("retains active guest key policies through explicit dictionary get", () => {
  const state = fixture();
  state.run("Dict=type({})\nclass Key:\n def __hash__(self):\n  visit('hash')\n  return 7\n def __eq__(self,other):\n  visit('equal')\n  return True\nkey=Key()\nd={key:42}\nresult=Dict.get(d,Key())\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(42));
  expect(state.events).toEqual(["hash", "hash", "equal"]);
});

it.each(["keys", "values", "items"])("retains live dictionary %s views through canonical descriptors", name => {
  const state = fixture();
  state.run(`Dict=type({})\nList=type([])\nd={'a':1}\nview=Dict.${name}(d)\nd['b']=2\nresult=List(view)\ncorrect=result==${name === "keys" ? "['a','b']" : name === "values" ? "[1,2]" : "[('a',1),('b',2)]"}\n`);
  expect(state.globals.get("correct")).toBe(state.v.true);
});

it("retains native list in-place repetition after a forward numeric override declines", () => {
  const state = fixture(); state.globals.set("NotImplemented", state.v.notImplemented);
  state.run("List=type([])\nclass Child(List):\n def __mul__(self,other):\n  visit('multiply')\n  return NotImplemented\nitems=Child([1])\noriginal=items\nitems*=2\nsame=items is original\ncorrect=items==[1,1]\n");
  expect(state.globals.get("same")).toBe(state.v.true); expect(state.globals.get("correct")).toBe(state.v.true); expect(state.events).toEqual(["multiply"]);
  expect(() => state.run("items*=1.5\n")).toThrow("can't multiply sequence by non-int of type 'float'");
});

it("allocates owned tuple subclasses with dictionaries and inherited protocols", () => {
  const state = fixture();
  state.run("Tuple=type(())\nclass Child(Tuple):\n pass\nitems=Child([1,2,1])\nitems.label='owned'\ncorrect=type(items) is Child\nlabel=items.label\nsize=items.__len__()\nfound=items.__contains__(2)\ncount=items.count(1)\nindex=items.index(2)\nitem=items[1]\ntext=f'{items!r}'\nequal=items==(1,2,1)\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.globals.get("found")).toBe(state.v.true); expect(state.globals.get("equal")).toBe(state.v.true);
  expect(state.globals.get("label")).toEqual(state.v.string("owned")); expect(state.globals.get("text")).toEqual(state.v.string("(1, 2, 1)"));
  for (const [name, value] of [["size", 3], ["count", 2], ["index", 1], ["item", 2]] as const) expect(state.globals.get(name)).toEqual(state.v.integer(value));
  expect(() => state.run("items.native\n")).toThrow("has no attribute 'native'");
});

it("keeps tuple subclass copies exact and fresh without exposing backing identity", () => {
  const state = fixture();
  state.run("Tuple=type(())\nclass Child(Tuple):\n pass\nitems=Child([1])\nfirst=items[:]\nsecond=items[:]\nfresh=first is not second\nexact=type(first) is Tuple\nrepeat=items*1\nfresh_repeat=repeat is not items*1\njoined=items+()\nfresh_join=joined is not items+()\nleft=()+items\nfresh_left=left is not ()+items\ncontents=first==(1,) and repeat==(1,) and joined==(1,) and left==(1,)\n");
  for (const name of ["fresh", "exact", "fresh_repeat", "fresh_join", "fresh_left", "contents"]) expect(state.globals.get(name), name).toBe(state.v.true);
});

it("passes tuple subclass keywords to custom initialization and preserves validation", () => {
  const state = fixture();
  state.run("Tuple=type(())\nclass Child(Tuple):\n def __init__(self,source,flag):\n  self.flag=flag\nitems=Child([1],flag=2)\nflag=items.flag\ncorrect=items==(1,)\nclass Plain(Tuple):\n pass\n");
  expect(state.globals.get("flag")).toEqual(state.v.integer(2)); expect(state.globals.get("correct")).toBe(state.v.true);
  expect(() => state.run("Plain([1],flag=2)\n")).toThrow("tuple() takes no keyword arguments");
  expect(() => state.run("Plain([1],[2])\n")).toThrow("tuple expected at most 1 argument, got 2");
});

it("honors tuple subclass iteration for construction but bypasses it in native arithmetic", () => {
  const state = fixture();
  state.run("Tuple=type(())\nclass Child(Tuple):\n def __iter__(self):\n  visit('iter')\n  return [9].__iter__()\nitems=Child([1])\nconstructed=Tuple(items)==(9,)\njoined=Tuple.__add__(items,())==(1,)\nrepeated=Tuple.__mul__(items,2)==(1,1)\n");
  expect(state.events).toEqual(["iter"]);
  for (const name of ["constructed", "joined", "repeated"]) expect(state.globals.get(name)).toBe(state.v.true);
});

it("preserves explicit tuple subclass hashing and recursive representation", () => {
  const state = fixture();
  state.run("Tuple=type(())\nclass Child(Tuple):\n __hash__=None\n def __repr__(self):\n  return 'override'\nitems=Child([1])\ntext=f'{items!r}'\nbase=Tuple.__repr__(items)\nhash=Tuple.__hash__(items)\nclass Value:\n def __repr__(self):\n  return Tuple.__repr__(cycle)\ncycle=Child([Value()])\nrecursive=Tuple.__repr__(cycle)\n");
  expect(state.globals.get("text")).toEqual(state.v.string("override")); expect(state.globals.get("base")).toEqual(state.v.string("(1,)")); expect(state.globals.get("hash")).toEqual(state.v.integer(-6644214454873602895n)); expect(state.globals.get("recursive")).toEqual(state.v.string("((...),)"));
});

it("does not add weak-reference storage to variable-size tuple subclasses", () => {
  const state = fixture(); state.run("Tuple=type(())\nclass Child(Tuple):\n pass\nitems=Child([1])\n");
  expect(() => state.run("Child.__weakref__\n")).toThrow("has no attribute '__weakref__'");
  expect(() => state.run("items.__weakref__\n")).toThrow("has no attribute '__weakref__'");
});

it("enforces variable-size tuple subclass slot restrictions", () => {
  const state = fixture(); state.run("Tuple=type(())\nclass Child(Tuple):\n __slots__=()\nitems=Child([1])\n");
  expect(() => state.run("items.label=1\n")).toThrow("has no attribute 'label'");
  expect(() => state.run("class Invalid(Tuple):\n __slots__=('field',)\n")).toThrow("nonempty __slots__ not supported for subtype of 'tuple'");
  expect(() => state.run("class Invalid(Child):\n __slots__=('field',)\n")).toThrow("nonempty __slots__ not supported for subtype of 'Child'");
});

it("preserves tuple subclass sequence fallback errors and guest reflection", () => {
  const state = fixture();
  state.run("Tuple=type(())\nclass Child(Tuple):\n pass\nclass Other:\n def __rmul__(self,other):\n  visit('reflected')\n  return 7\nitems=Child([1])\nresult=items*Other()\nreverse=2*items==(1,1)\n");
  expect(state.events).toEqual(["reflected"]); expect(state.globals.get("result")).toEqual(state.v.integer(7)); expect(state.globals.get("reverse")).toBe(state.v.true);
  expect(() => state.run("items*1.5\n")).toThrow("can't multiply sequence by non-int of type 'float'");
  expect(() => state.run("items.__mul__(1.5)\n")).toThrow("'float' object cannot be interpreted as an integer");
});

it("constructs exact tuples and preserves exact input and empty identities", () => {
  const state = fixture();
  state.run("Tuple=type(())\nitems=([1],)\nsame=Tuple(items) is items\ndirect=Tuple.__new__(Tuple,items) is items\nempty=Tuple() is ()\ncollected=Tuple([]) is ()\nmember=[]\ncopy=Tuple([member])\nretained=copy[0] is member\ncorrect=type(copy) is Tuple\n");
  for (const name of ["same", "direct", "empty", "collected", "retained", "correct"]) expect(state.globals.get(name), name).toBe(state.v.true);
});

it("shares empty tuple identity across repetition, slicing and independent runs", () => {
  const state = fixture(); state.globals.set("emptySlice", state.v.slice({ lower: state.v.integer(0), upper: state.v.integer(0) }));
  state.run("original=()\nrepeated=(1,).__mul__(0) is original\nsliced=(1,).__getitem__(emptySlice) is original\n");
  state.run("same=original is ()\n");
  for (const name of ["repeated", "sliced", "same"]) expect(state.globals.get(name), name).toBe(state.v.true);
});

it("constructs tuples from guest iterables without requesting length hints", () => {
  const state = fixture();
  state.run("class Source:\n def __iter__(self):\n  visit('iter')\n  return [1,2].__iter__()\n def __len__(self):\n  visit('len')\n  return 99\n def __length_hint__(self):\n  visit('hint')\n  return 99\nTuple=type(())\nresult=Tuple(Source())==(1,2)\n");
  expect(state.events).toEqual(["iter"]); expect(state.globals.get("result")).toBe(state.v.true);
});

it("preserves tuple construction failures and leaves the source cursor open", () => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "iteration failed");
  state.globals.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Source:\n def __iter__(self):\n  self.first=True\n  return self\n def __next__(self):\n  visit('next')\n  if self.first:\n   self.first=False\n   return 1\n  fail()\n def close(self):\n  visit('close')\nsource=Source()\nTuple=type(())\n");
  let caught: unknown; try { state.run("result=Tuple(source)\n"); } catch (error) { caught = error; }
  expect(caught).toBe(failure); expect(state.globals.has("result")).toBe(false); expect(state.events).toEqual(["next", "next"]);
});

it("validates tuple construction before consuming the source", () => {
  const state = fixture();
  state.run("class Source:\n def __iter__(self):\n  visit('iter')\n  return [].__iter__()\nTuple=type(())\nsource=Source()\n");
  expect(() => state.run("Tuple(source,source)\n")).toThrow("tuple expected at most 1 argument, got 2");
  expect(() => state.run("Tuple(source,source,extra=1)\n")).toThrow("tuple() takes no keyword arguments");
  expect(() => state.run("Tuple.__new__()\n")).toThrow("tuple.__new__(): not enough arguments");
  expect(() => state.run("Tuple.__new__(None)\n")).toThrow("tuple.__new__(X): X is not a type object (NoneType)");
  expect(() => state.run("Tuple.__new__(type([]))\n")).toThrow("tuple.__new__(list): list is not a subtype of tuple");
  expect(state.events).toEqual([]);
});

it("binds tuple arithmetic wrappers and retains immutable identity shortcuts", () => {
  const state = fixture();
  state.run("items=(1,2)\nTuple=type(items)\njoined=Tuple.__add__(items,(3,))==(1,2,3)\nleft=Tuple.__add__((),items) is items\nright=items.__add__(()) is items\nonce=items.__mul__(1) is items\nrepeated=items.__rmul__(2)==(1,2,1,2)\nempty=items.__mul__(0)==()\nbound=items.__mul__.__self__ is items\nowner=Tuple.__mul__.__objclass__ is Tuple\nmember=Tuple.__mul__\n");
  for (const name of ["joined", "left", "right", "once", "repeated", "empty", "bound", "owner"]) expect(state.globals.get(name), name).toBe(state.v.true);
  expect(state.globals.get("member")?.kind).toBe("wrapper_descriptor");
});

it("keeps explicit tuple arithmetic independent of guest numeric reflection", () => {
  const state = fixture();
  state.run("class Operand:\n def __radd__(self,other):\n  visit('add')\n  return 9\n def __rmul__(self,other):\n  visit('multiply')\n  return 8\n def __index__(self):\n  visit('index')\n  return 2\nitems=(1,)\noperand=Operand()\nadded=items+operand\nmultiplied=items*operand\nexplicit=items.__mul__(operand)==(1,1)\nreverse=items.__rmul__(operand)==(1,1)\n");
  expect(state.events).toEqual(["add", "multiply", "index", "index"]);
  expect(state.globals.get("added")).toEqual(state.v.integer(9)); expect(state.globals.get("multiplied")).toEqual(state.v.integer(8)); expect(state.globals.get("explicit")).toBe(state.v.true); expect(state.globals.get("reverse")).toBe(state.v.true);
  expect(() => state.run("items.__add__(operand)\n")).toThrow('can only concatenate tuple (not "Operand") to tuple');
  expect(state.events).toEqual(["add", "multiply", "index", "index"]);
});

it.each(["__mul__", "__rmul__"])("validates tuple %s counts before empty identity shortcuts", name => {
  const state = fixture();
  state.run("class Huge:\n def __index__(self):\n  visit('index')\n  return 2**100\nitems=()\n");
  expect(() => state.run(`items.${name}(Huge())\n`)).toThrow("cannot fit 'Huge' into an index-sized integer");
  expect(state.events).toEqual(["index"]);
  expect(() => state.run(`items.${name}(1.5)\n`)).toThrow("'float' object cannot be interpreted as an integer");
  expect(() => state.run(`items.${name}(None)\n`)).toThrow("'NoneType' object cannot be interpreted as an integer");
});

it.each(["__add__", "__mul__", "__rmul__"])("validates the tuple %s descriptor receiver and arguments", name => {
  const state = fixture(); state.run("Tuple=type(())\n");
  expect(() => state.run(`Tuple.${name}()\n`)).toThrow(`descriptor '${name}' of 'tuple' object needs an argument`);
  expect(() => state.run(`Tuple.${name}([])\n`)).toThrow(`descriptor '${name}' requires a 'tuple' object but received a 'list'`);
  expect(() => state.run(`Tuple.${name}(())\n`)).toThrow("expected 1 argument, got 0");
  expect(() => state.run(`Tuple.${name}((),1,2)\n`)).toThrow("expected 1 argument, got 2");
  expect(() => state.run(`Tuple.${name}((),extra=1)\n`)).toThrow(`wrapper ${name}() takes no keyword arguments`);
});

it("publishes canonical tuple sequence and search descriptors", () => {
  const state = fixture();
  state.run("items=(1,2,1)\nTuple=type(items)\nsize=Tuple.__len__(items)\nfound=Tuple.__contains__(items,2)\ncount=Tuple.count(items,1)\nindex=Tuple.index(items,1,1)\nitem=Tuple.__getitem__(items,1)\niterator=Tuple.__iter__(items)\nfirst=iterator.__next__()\nbound=items.count.__self__ is items\nowner=Tuple.count.__objclass__ is Tuple\nstable=items.count==items.count\n");
  for (const [name, value] of [["size", 3], ["count", 2], ["index", 2], ["item", 2], ["first", 1]] as const) expect(state.globals.get(name)).toEqual(state.v.integer(value));
  for (const name of ["found", "bound", "owner", "stable"]) expect(state.globals.get(name)).toBe(state.v.true);
});

it("uses active guest index and equality policies through tuple descriptors", () => {
  const state = fixture();
  state.run("class Index:\n def __index__(self):\n  visit('index')\n  return 1\nclass Value:\n def __eq__(self,other):\n  visit('eq')\n  return True\nitems=(Value(),Value())\nTuple=type(items)\nselected=Tuple.__getitem__(items,Index()) is items[1]\nfound=Tuple.__contains__(items,9)\ncount=Tuple.count(items,9)\nindex=Tuple.index(items,9,Index())\n");
  expect(state.events).toEqual(["index", "eq", "eq", "eq", "index", "eq"]);
  expect(state.globals.get("selected")).toBe(state.v.true); expect(state.globals.get("found")).toBe(state.v.true); expect(state.globals.get("count")).toEqual(state.v.integer(2)); expect(state.globals.get("index")).toEqual(state.v.integer(1));
});

it("keeps tuple comparisons receiver-local and preserves guest ordering results", () => {
  const state = fixture(); state.globals.set("NotImplemented", state.v.notImplemented);
  state.run("class Value:\n def __eq__(self,other):\n  visit('eq')\n  return False\n def __lt__(self,other):\n  visit('lt')\n  return 7\nitems=(Value(),)\nTuple=type(items)\nresult=Tuple.__lt__(items,(Value(),))\ndeclined=Tuple.__eq__(items,[]) is NotImplemented\n");
  expect(state.events).toEqual(["eq", "lt"]); expect(state.globals.get("result")).toEqual(state.v.integer(7)); expect(state.globals.get("declined")).toBe(state.v.true);
});

it("represents tuple members through active guest repr and inherited object string slots", () => {
  const state = fixture();
  state.run("class Value:\n def __repr__(self):\n  visit('repr')\n  return 'value'\nitems=(Value(),)\nTuple=type(items)\ntext=Tuple.__repr__(items)\nstring=Tuple.__str__(items)\nformatted=Tuple.__format__(items,'')\nbound=items.__repr__.__self__ is items\n");
  expect(state.events).toEqual(["repr", "repr", "repr"]);
  for (const name of ["text", "string", "formatted"]) expect(state.globals.get(name)).toEqual(state.v.string("(value,)")); expect(state.globals.get("bound")).toBe(state.v.true);
});

it("hashes tuple members through the active policy without caching guest hashes", () => {
  const state = fixture();
  state.run("class Value:\n def __hash__(self):\n  visit('hash')\n  return 1\nitems=(Value(),)\nTuple=type(items)\nfirst=Tuple.__hash__(items)\nsecond=items.__hash__()\n");
  expect(state.events).toEqual(["hash", "hash"]); expect(state.globals.get("first")).toEqual(state.v.integer(-6644214454873602895n)); expect(state.globals.get("second")).toEqual(state.globals.get("first"));
});

it("retains tuple slice identity and shares recursive representation guards", () => {
  const state = fixture(); state.globals.set("whole", state.v.slice({})); state.globals.set("reverse", state.v.slice({ step: state.v.integer(-1) }));
  state.run("items=(1,2,3)\nTuple=type(items)\nsame=Tuple.__getitem__(items,whole) is items\nreversed=Tuple.__getitem__(items,reverse)==(3,2,1)\nclass Value:\n def __repr__(self):\n  return Tuple.__repr__(cycle)\ncycle=(Value(),)\ntext=Tuple.__repr__(cycle)\n");
  expect(state.globals.get("same")).toBe(state.v.true); expect(state.globals.get("reversed")).toBe(state.v.true); expect(state.globals.get("text")).toEqual(state.v.string("((...),)"));
});

it("exposes tuple subscription as a wrapper and validates receiver and argument shape", () => {
  const state = fixture(); state.run("Tuple=type(())\nmember=Tuple.__getitem__\ndoc=member.__doc__\n");
  expect(state.globals.get("member")?.kind).toBe("wrapper_descriptor"); expect(state.globals.get("doc")).toEqual(state.v.string("Return self[key]."));
  expect(() => state.run("Tuple.__getitem__()\n")).toThrow("descriptor '__getitem__' of 'tuple' object needs an argument");
  expect(() => state.run("Tuple.__getitem__(None)\n")).toThrow("descriptor '__getitem__' requires a 'tuple' object but received a 'NoneType'");
  expect(() => state.run("Tuple.__getitem__(())\n")).toThrow("expected 1 argument, got 0");
  expect(() => state.run("Tuple.__getitem__((),extra=1)\n")).toThrow("wrapper __getitem__() takes no keyword arguments");
  expect(() => state.run("Tuple.__hash__(([],))\n")).toThrow("unhashable type: 'list'");
});

it("preserves original tuple member hash failures", () => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "hash failed");
  state.globals.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Value:\n def __hash__(self):\n  fail()\nitems=(Value(),)\nTuple=type(items)\n");
  let caught: unknown; try { state.run("Tuple.__hash__(items)\n"); } catch (error) { caught = error; } expect(caught).toBe(failure);
});

it.each(["set", "frozenset"] as const)("executes native %s operator descriptors with original binding and reversed orientation", kind => {
  for (const [suffix, symbol] of [["or", "|"], ["and", "&"], ["sub", "-"], ["xor", "^"]]) {
    const state = fixture(); state.globals.set("Base", state.registry.setType(kind)); state.globals.set("Other", state.registry.setType(kind === "set" ? "frozenset" : "set")); state.globals.set("NotImplemented", state.v.notImplemented);
    state.run("class Child(Base):\n pass\na=Child([1])\nb=Other([2])\n");
    state.run(`forward=a.__${suffix}__(b)\nreflected=a.__r${suffix}__(b)\ncorrect=type(forward) is Base and type(reflected) is Other\nbinding=a.__${suffix}__.__self__ is a\nowner=Base.__${suffix}__.__objclass__ is Base\nrejected=a.__${suffix}__([]) is NotImplemented\nequal=forward==Base([1])${symbol}b and reflected==b${symbol}Base([1])\n`);
    for (const name of ["correct", "binding", "owner", "rejected", "equal"]) expect(state.globals.get(name), suffix + ":" + name).toBe(state.v.true);
    expect(() => state.run(`a.__${suffix}__()\n`)).toThrow("expected 1 argument, got 0");
    expect(() => state.run(`a.__${suffix}__(b,extra=1)\n`)).toThrow(`wrapper __${suffix}__() takes no keyword arguments`);
  }
});

it.each([["or", "|", [1, 2]], ["and", "&", []], ["sub", "-", [1]], ["xor", "^", [1, 2]]] as const)("preserves set storage and identity through native in-place %s", (suffix, symbol, expected) => {
  const state = fixture(); state.globals.set("Base", state.registry.setType("set")); state.globals.set("NotImplemented", state.v.notImplemented);
  state.run("class Child(Base):\n pass\nsource=Child([2])\n");
  for (const type of ["Base", "Child"]) {
    state.run(`items=${type}([1])\noriginal=items\nitems${symbol}=source\nsame=items is original\ncorrect=items==Base([${expected.join(",")}])\nexplicit=items.__i${suffix}__(Base()) is items\nrejected=items.__i${suffix}__([]) is NotImplemented\n`);
    for (const name of ["same", "correct", "explicit", "rejected"]) expect(state.globals.get(name), type + ":" + name).toBe(state.v.true);
  }
});

it.each(["set", "frozenset"] as const)("negotiates reflected %s subclass overrides before native forward operations", kind => {
  const state = fixture(); state.globals.set("Base", state.registry.setType(kind)); state.globals.set("NotImplemented", state.v.notImplemented);
  state.run("class Child(Base):\n def __ror__(self,other):\n  visit('reflected')\n  return NotImplemented\nleft=Base([1])\nright=Child([2])\nresult=left|right\ncorrect=result==Base([1,2])\nexact=type(result) is Base\n");
  expect(state.events).toEqual(["reflected"]); expect(state.globals.get("correct")).toBe(state.v.true); expect(state.globals.get("exact")).toBe(state.v.true);
});

it.each(["set", "frozenset"] as const)("falls back from declined %s in-place overrides without mutating old storage", kind => {
  const state = fixture(); state.globals.set("Base", state.registry.setType(kind)); state.globals.set("NotImplemented", state.v.notImplemented);
  state.run("class Child(Base):\n def __ior__(self,other):\n  visit('inplace')\n  return NotImplemented\nitems=Child([1])\noriginal=items\nitems|=Base([2])\nfresh=items is not original\nexact=type(items) is Base\nunchanged=original==Base([1])\ncorrect=items==Base([1,2])\n");
  expect(state.events).toEqual(["inplace"]);
  for (const name of ["fresh", "exact", "unchanged", "correct"]) expect(state.globals.get(name), name).toBe(state.v.true);
});

it.each(["set", "frozenset"] as const)("publishes inherited %s read methods with canonical binding and exact results", kind => {
  const state = fixture(); state.globals.set("Base", state.registry.setType(kind));
  state.run("class Child(Base):\n pass\nitems=Child([1])\ncopy=items.copy()\nexact=type(copy) is Base\nbound=items.copy.__self__ is items\nowner=Base.copy.__objclass__ is Base\nsame=items.copy==items.copy\nunion=items.union([2])==Base([1,2])\nintersection=items.intersection([1,2])==Base([1])\ndifference=items.difference([1])==Base()\nxor=items.symmetric_difference([1,2])==Base([2])\nsubset=items.issubset([1,2])\nsuperset=items.issuperset([1])\ndisjoint=items.isdisjoint([2])\n");
  for (const name of ["exact", "bound", "owner", "same", "union", "intersection", "difference", "xor", "subset", "superset", "disjoint"]) expect(state.globals.get(name), name).toBe(state.v.true);
});

it.each(["set", "frozenset"] as const)("short circuits %s self-disjointness before subclass iteration", kind => {
  const state = fixture(); state.globals.set("Base", state.registry.setType(kind));
  state.run("class Child(Base):\n def __iter__(self):\n  visit('iter')\n  return [9].__iter__()\nfull=Child([1])\nempty=Child()\nnonempty=not full.isdisjoint(full)\nzero=empty.isdisjoint(empty)\n");
  expect(state.events).toEqual([]); expect(state.globals.get("nonempty")).toBe(state.v.true); expect(state.globals.get("zero")).toBe(state.v.true);
});

it.each(["set", "frozenset"] as const)("validates %s descriptors before accessing native storage", kind => {
  const state = fixture(); state.globals.set("Base", state.registry.setType(kind));
  expect(() => state.run("Base.copy()\n")).toThrow(`unbound method ${kind}.copy() needs an argument`);
  expect(() => state.run("Base.copy(None)\n")).toThrow(`descriptor 'copy' for '${kind}' objects doesn't apply to a 'NoneType' object`);
  expect(() => state.run("Base.copy([])\n")).toThrow(`descriptor 'copy' for '${kind}' objects doesn't apply to a 'list' object`);
  expect(() => state.run("Base().copy(1)\n")).toThrow(`${kind}.copy() takes no arguments (1 given)`);
  expect(() => state.run("Base().copy(extra=1)\n")).toThrow(`${kind}.copy() takes no keyword arguments`);
});

it("copies frozen subclasses freshly while retaining exact frozen identity", () => {
  const state = fixture(); state.globals.set("Base", state.registry.setType("frozenset"));
  state.run("class Child(Base):\n pass\nbase=Base([1])\nchild=Child(base)\nfresh=child.copy() is not child.copy()\nseparate=child.copy() is not base\nsame=base.copy() is base\n");
  for (const name of ["fresh", "separate", "same"]) expect(state.globals.get(name)).toBe(state.v.true);
});

it("inherits all mutable set methods and preserves ordinary overrides", () => {
  const state = fixture(); state.globals.set("Base", state.registry.setType("set"));
  state.run("class Child(Base):\n def add(self,value):\n  visit('override')\nitems=Child([1])\nitems.add(9)\nBase.add(items,2)\nitems.update([3])\nitems.remove(1)\nitems.discard(9)\nitems.intersection_update([2,3])\nitems.difference_update([2])\nitems.symmetric_difference_update([3,4])\nresult=items.pop()\nitems.clear()\nempty=items==Base()\n");
  expect(state.events).toEqual(["override"]); expect(state.globals.get("result")).toEqual(state.v.integer(4)); expect(state.globals.get("empty")).toBe(state.v.true);
});

it.each(["set", "frozenset"] as const)("bypasses overridden source iteration in %s native methods", kind => {
  const state = fixture(); state.globals.set("Base", state.registry.setType(kind)); state.globals.set("Mutable", state.registry.setType("set"));
  state.run("class Child(Base):\n def __iter__(self):\n  visit('iter')\n  return [9].__iter__()\nsource=Child([1])\nitems=Base([1])\nunion=items.union(source)==items\nintersection=items.intersection(source)==items\ndifference=items.difference(source)==Base()\nxor=items.symmetric_difference(source)==Base()\nsubset=items.issubset(source)\nsuperset=items.issuperset(source)\ndisjoint=items.isdisjoint(source)\na=Mutable([1])\na.difference_update(source)\nb=Mutable([1])\nb.intersection_update(source)\nc=Mutable([1])\nc.symmetric_difference_update(source)\nmutation=a==Mutable() and b==Mutable([1]) and c==Mutable()\n");
  expect(state.events).toEqual(["iter"]);
  for (const name of ["union", "intersection", "difference", "xor", "subset", "superset", "disjoint", "mutation"]) expect(state.globals.get(name), name).toBe(state.v.true);
});

it.each(["set", "frozenset"] as const)("allocates owned %s subclasses with dictionaries and native protocols", kind => {
  const state = fixture(); state.globals.set("Base", state.registry.setType(kind));
  state.run("class Child(Base):\n pass\nitems=Child([1])\nitems.label='owned'\nresult=f'{items!r}'\ncorrect=type(items) is Child\nsize=items.__len__()\nfound=items.__contains__(1)\nempty=f'{Child()!r}'\nbase=Base.__repr__(items)\n");
  expect(state.globals.get("result")).toEqual(state.v.string("Child({1})")); expect(state.globals.get("base")).toEqual(state.v.string("Child({1})")); expect(state.globals.get("empty")).toEqual(state.v.string("Child()"));
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.globals.get("size")).toEqual(state.v.integer(1n)); expect(state.globals.get("found")).toBe(state.v.true);
  state.run("label=items.label\n"); expect(state.globals.get("label")).toEqual(state.v.string("owned")); expect(() => state.run("items.native\n")).toThrow("has no attribute 'native'");
});

it.each(["set", "frozenset"] as const)("preserves %s subclass slot storage and explicit repr semantics", kind => {
  const state = fixture(); state.globals.set("Base", state.registry.setType(kind));
  state.run("class Child(Base):\n __slots__=('label',)\n def __repr__(self):\n  return 'override'\nitems=Child([1])\nitems.label=2\nresult=f'{items!r}'\nbase=Base.__repr__(items)\nlabel=items.label\n");
  expect(state.globals.get("result")).toEqual(state.v.string("override")); expect(state.globals.get("base")).toEqual(state.v.string("Child({1})")); expect(state.globals.get("label")).toEqual(state.v.integer(2n));
  expect(() => state.run("items.extra=1\n")).toThrow("has no attribute 'extra'");
});

it.each(["set", "frozenset"] as const)("allows %s subclass initializers to receive their keyword arguments", kind => {
  const state = fixture(); state.globals.set("Base", state.registry.setType(kind));
  state.run("class Child(Base):\n def __init__(self,source,label):\n  self.label=label\nitems=Child([1],label=2)\nresult=f'{items!r}'\nlabel=items.label\n");
  expect(state.globals.get("result")).toEqual(state.v.string(kind === "set" ? "Child()" : "Child({1})")); expect(state.globals.get("label")).toEqual(state.v.integer(2n));
});

it.each(["set", "frozenset"] as const)("uses the %s subclass name in constructor arity errors", kind => {
  const state = fixture(); state.globals.set("Base", state.registry.setType(kind)); state.run("class Child(Base):\n pass\n");
  expect(() => state.run("Child([1],[2])\n")).toThrow("Child expected at most 1 argument, got 2");
});

it.each(["set", "frozenset"] as const)("guards recursive %s subclass repr by original receiver identity", kind => {
  const state = fixture(); state.globals.set("Base", state.registry.setType(kind));
  state.run("class Child(Base):\n pass\nclass Value:\n def __repr__(self):\n  return Base.__repr__(items)\nitems=Child([Value()])\nresult=f'{items!r}'\n");
  expect(state.globals.get("result")).toEqual(state.v.string("Child({Child(...)})"));
});

it("reads a set subclass name after guest repr mutates it", () => {
  const state = fixture(); state.globals.set("Base", state.registry.setType("set"));
  state.run("class Child(Base):\n pass\nclass Value:\n def __repr__(self):\n  Child.__name__='Renamed'\n  return 'guest'\nitems=Child([Value()])\nresult=f'{items!r}'\n");
  expect(state.globals.get("result")).toEqual(state.v.string("Renamed({guest})"));
});

it.each(["disabled", "custom", "raises"])("uses %s hashing for native mutable-subclass membership probes", mode => {
  const state = fixture(); state.globals.set("Base", state.registry.setType("set")); state.globals.set("Frozen", state.registry.setType("frozenset"));
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw new PythonRuntimeError("TypeError", "hash failed"); } }));
  state.run(`class Child(Base):\n ${mode === "disabled" ? "pass" : `def __hash__(self):\n  ${mode === "custom" ? "return 1" : "fail()"}`}\nitems=Frozen([Frozen([1])])\nprobe=Child([1])\nresult=items.__contains__(probe)\n`);
  expect(state.globals.get("result")).toBe(mode === "custom" ? state.v.false : state.v.true);
});

it("converts mutable subclass probes after a comparison TypeError", () => {
  const state = fixture(); state.globals.set("Base", state.registry.setType("set"));
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw new PythonRuntimeError("TypeError", "eq failed"); } }));
  state.run("class Bad:\n def __hash__(self):\n  return 1\n def __eq__(self,other):\n  fail()\nclass Probe(Base):\n def __hash__(self):\n  return 1\nitems={Bad()}\nresult=items.__contains__(Probe([1]))\n");
  expect(state.globals.get("result")).toBe(state.v.false);
});

it("copies native set-subclass storage without invoking overridden iteration", () => {
  const state = fixture(); state.globals.set("Base", state.registry.setType("set"));
  state.run("class Child(Base):\n def __iter__(self):\n  visit('iter')\n  return [2].__iter__()\nitems=Child([1])\ncopy=Base(items)\nresult=f'{copy!r}'\n");
  expect(state.globals.get("result")).toEqual(state.v.string("{1}")); expect(state.events).toEqual([]);
});

it("allocates exact sets through normal native type calls", () => {
  const state = fixture(); state.run("Set=type({1})\nitems=Set([2,3])\nresult=f'{items!r}'\nempty=Set()\nother=Set()\nfresh=empty is not other\ncorrect=type(items) is Set\n");
  expect(state.globals.get("result")).toEqual(state.v.string("{2, 3}")); expect(state.globals.get("fresh")).toBe(state.v.true); expect(state.globals.get("correct")).toBe(state.v.true);
});

it("set allocation ignores initialization arguments without consuming them", () => {
  const state = fixture(); state.run("class Source:\n def __iter__(self):\n  visit('iterate')\n  return [1].__iter__()\nSet=type({1})\nitems=Set.__new__(Set,Source(),2,x=3)\nresult=f'{items!r}'\n");
  expect(state.globals.get("result")).toEqual(state.v.string("set()")); expect(state.events).toEqual([]);
});

it("constructs exact frozen sets during new and preserves exact input identity", () => {
  const state = fixture(); state.globals.set("Frozen", state.registry.setType("frozenset"));
  state.run("items=Frozen([1])\nresult=f'{items!r}'\nsame=Frozen(items) is items\ndirect=Frozen.__new__(Frozen,items) is items\nempty=f'{Frozen()!r}'\n");
  expect(state.globals.get("result")).toEqual(state.v.string("frozenset({1})")); expect(state.globals.get("same")).toBe(state.v.true); expect(state.globals.get("direct")).toBe(state.v.true); expect(state.globals.get("empty")).toEqual(state.v.string("frozenset()"));
});

it("frozen set allocation consumes guest sources exactly once", () => {
  const state = fixture(); state.globals.set("Frozen", state.registry.setType("frozenset"));
  state.run("class Source:\n def __iter__(self):\n  visit('iterate')\n  return [1].__iter__()\nitems=Frozen(Source())\nresult=f'{items!r}'\n");
  expect(state.globals.get("result")).toEqual(state.v.string("frozenset({1})")); expect(state.events).toEqual(["iterate"]);
});

it.each(["set", "frozenset"] as const)("validates %s native allocation type arguments", kind => {
  const state = fixture(); state.globals.set("SetType", state.registry.setType(kind));
  expect(() => state.run("SetType.__new__()\n")).toThrow(`${kind}.__new__(): not enough arguments`);
  expect(() => state.run("SetType.__new__(1)\n")).toThrow(`${kind}.__new__(X): X is not a type object (int)`);
  expect(() => state.run("SetType.__new__(type([]))\n")).toThrow(`list is not a subtype of ${kind}`);
});

it("initializes existing sets through their canonical native slot", () => {
  const state = fixture(); state.run("items={1}\nresult=type(items).__init__(items,[2,3])\ncontents=f'{items!r}'\nitems.__init__(items)\nempty=f'{items!r}'\nitems.add(4)\nitems.__init__()\ncleared=f'{items!r}'\n");
  expect(state.globals.get("result")).toBe(state.v.none); expect(state.globals.get("contents")).toEqual(state.v.string("{2, 3}"));
  for (const name of ["empty", "cleared"]) expect(state.globals.get(name)).toEqual(state.v.string("set()"));
});

it.each([["items.__init__(1,2)", "set expected at most 1 argument, got 2"], ["items.__init__(x=1)", "set() takes no keyword arguments"]])("validates set initialization before mutation: %s", (source, message) => {
  const state = fixture(); state.run("items={1}\n"); expect(() => state.run(source+"\n")).toThrow(message);
  state.run("result=f'{items!r}'\n"); expect(state.globals.get("result")).toEqual(state.v.string("{1}"));
});

it("clears a set before acquiring a guest iterator and retains partial failure", () => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "iteration failed");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Source:\n def __iter__(self):\n  visit(f'{items!r}')\n  self.first=True\n  return self\n def __next__(self):\n  if self.first:\n   self.first=False\n   return 2\n  fail()\nitems={1}\n");
  let caught: unknown; try { state.run("items.__init__(Source())\n"); } catch (error) { caught = error; }
  expect(caught).toBe(failure); expect(state.events).toEqual(["set()"]); expect(state.calls.depth).toBe(0);
  state.run("result=f'{items!r}'\n"); expect(state.globals.get("result")).toEqual(state.v.string("{2}"));
});

it("clears a set before rejecting a noniterable initializer", () => {
  const state = fixture(); state.run("items={1}\n"); expect(() => state.run("items.__init__(None)\n")).toThrow("'NoneType' object is not iterable");
  state.run("result=f'{items!r}'\n"); expect(state.globals.get("result")).toEqual(state.v.string("set()"));
});

it.each([["set", constructRuntimeSet], ["frozenset", constructRuntimeFrozenSet]] as const)("publishes canonical %s representation and sequence slots", (kind, construct) => {
  const state = fixture(); state.builtins.set(kind, state.v.builtinFunction({ name: kind, invoke(args, keywords, meter, invocation) { return construct(args, keywords, state.v, state.keys, meter, invocation?.iteration); } }));
  state.run(`items=${kind}([1])\nowner=type(items)\nresult=owner.__repr__(items)\nsize=owner.__len__(items)\ncontains=owner.__contains__(items,1)\nmethod=items.__repr__\ncanonical=method.__objclass__ is owner\niterator=owner.__iter__(items)\nseen=0\nfor value in iterator:\n seen=seen+value\n`);
  expect(state.globals.get("result")).toEqual(state.v.string(kind === "set" ? "{1}" : "frozenset({1})"));
  expect(state.globals.get("size")).toEqual(state.v.integer(1n)); expect(state.globals.get("contains")).toBe(state.v.true); expect(state.globals.get("canonical")).toBe(state.v.true); expect(state.globals.get("seen")).toEqual(state.v.integer(1n));
});

it.each([["set", constructRuntimeSet], ["frozenset", constructRuntimeFrozenSet]] as const)("publishes canonical %s native comparison and hash slots", (kind, construct) => {
  const state = fixture(); state.globals.set("NotImplemented", state.v.notImplemented); state.builtins.set(kind, state.v.builtinFunction({ name: kind, invoke(args, keywords, meter, invocation) { return construct(args, keywords, state.v, state.keys, meter, invocation?.iteration); } }));
  state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.run(`items=${kind}([1])\nother=${kind}([1])\nowner=type(items)\nequal=owner.__eq__(items,other)\nless=owner.__lt__(items,other)\nless_equal=owner.__le__(items,other)\ngreater=owner.__gt__(items,other)\ngreater_equal=owner.__ge__(items,other)\nunequal=owner.__ne__(items,other)\ndeclined=owner.__eq__(items,1) is NotImplemented\n`);
  for (const name of ["equal", "less_equal", "greater_equal", "declined"]) expect(state.globals.get(name)).toBe(state.v.true);
  for (const name of ["less", "greater", "unequal"]) expect(state.globals.get(name)).toBe(state.v.false);
  if (kind === "set") { state.run("unhashable=owner.__hash__ is None\n"); expect(state.globals.get("unhashable")).toBe(state.v.true); }
  else { state.run("same_hash=owner.__hash__(items)==hash(items)\n"); expect(state.globals.get("same_hash")).toBe(state.v.true); }
});

it.each(["set", "frozenset"])("compares mixed set families and converts mutable probes through %s slots", kind => {
  const state = fixture();
  for (const [name, construct] of [["set", constructRuntimeSet], ["frozenset", constructRuntimeFrozenSet]] as const) state.builtins.set(name, state.v.builtinFunction({ name, invoke(args, keywords, meter, invocation) { return construct(args, keywords, state.v, state.keys, meter, invocation?.iteration); } }));
  state.run(`items=${kind}([1])\nother=${kind === "set" ? "frozenset" : "set"}([1,2])\nsubset=type(items).__lt__(items,other)\nsuperset=type(other).__gt__(other,items)\nkeys=${kind}([frozenset([1])])\nfound=type(keys).__contains__(keys,{1})\n`);
  for (const name of ["subset", "superset", "found"]) expect(state.globals.get(name)).toBe(state.v.true);
});

it.each([["set", constructRuntimeSet], ["frozenset", constructRuntimeFrozenSet]] as const)("validates canonical %s slot signatures and ownership", (kind, construct) => {
  const state = fixture(); state.builtins.set(kind, state.v.builtinFunction({ name: kind, invoke(args, keywords, meter, invocation) { return construct(args, keywords, state.v, state.keys, meter, invocation?.iteration); } }));
  state.run(`items=${kind}()\nowner=type(items)\ncontains_owner=owner.__contains__.__objclass__ is owner\n`);
  expect(state.globals.get("contains_owner")).toBe(state.v.true);
  expect(() => state.run("items.__contains__()\n")).toThrow(`${kind}.__contains__() takes exactly one argument (0 given)`);
  expect(() => state.run("items.__contains__(1,2)\n")).toThrow(`${kind}.__contains__() takes exactly one argument (2 given)`);
  expect(() => state.run("items.__contains__(x=1)\n")).toThrow(`${kind}.__contains__() takes no keyword arguments`);
  expect(() => state.run("owner.__repr__(1)\n")).toThrow(`requires a '${kind}' object`);
  expect(() => state.run("items.__len__(1)\n")).toThrow("expected 0 arguments, got 1");
});

it("canonical set iteration observes size-changing mutation", () => {
  const state = fixture(); state.run("items={1}\niterator=type(items).__iter__(items)\nitems.add(2)\n");
  expect(() => state.run("for item in iterator:\n pass\n")).toThrow("Set changed size during iteration");
});

it.each([["set", constructRuntimeSet], ["frozenset", constructRuntimeFrozenSet]] as const)("represents %s contents using active guest repr", (kind, construct) => {
  const state = fixture(); state.builtins.set(kind, state.v.builtinFunction({ name: kind, invoke(args, keywords, meter, invocation) { return construct(args, keywords, state.v, state.keys, meter, invocation?.iteration); } }));
  state.run(`class Value:\n def __repr__(self):\n  visit('repr')\n  return 'guest'\nitems=${kind}([Value()])\nresult=f'{items!r}'\nexplicit=items.__repr__()\ntext=items.__str__()\nformatted=items.__format__('')\nempty=f'{${kind}()!r}'\n`);
  const expected = kind === "set" ? "{guest}" : "frozenset({guest})";
  for (const name of ["result", "explicit", "text", "formatted"]) expect(state.globals.get(name)).toEqual(state.v.string(expected));
  expect(state.globals.get("empty")).toEqual(state.v.string(`${kind}()`)); expect(state.events).toEqual(Array(4).fill("repr"));
});

it.each([["set", constructRuntimeSet], ["frozenset", constructRuntimeFrozenSet]] as const)("shares recursion guards with explicit %s repr", (kind, construct) => {
  const state = fixture(); state.builtins.set(kind, state.v.builtinFunction({ name: kind, invoke(args, keywords, meter, invocation) { return construct(args, keywords, state.v, state.keys, meter, invocation?.iteration); } }));
  state.run(`class Value:\n def __repr__(self):\n  return items.__repr__()\nitems=${kind}([Value()])\nresult=f'{items!r}'\n`);
  expect(state.globals.get("result")).toEqual(state.v.string(kind === "set" ? "{set(...)}" : "frozenset({frozenset(...)})"));
});

it.each([["set", constructRuntimeSet], ["frozenset", constructRuntimeFrozenSet]] as const)("restores %s representation guards after guest errors", (kind, construct) => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set(kind, state.v.builtinFunction({ name: kind, invoke(args, keywords, meter, invocation) { return construct(args, keywords, state.v, state.keys, meter, invocation?.iteration); } }));
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.builtins.set("recover", state.v.builtinFunction({ name: "recover", invoke(args, _keywords, _meter, invocation) {
    if (invocation === undefined) throw Error("expected invocation");
    let caught: unknown; try { invocation.call(args[0], []); } catch (error) { caught = error; }
    expect(caught).toBe(failure); return invocation.call(args[0], []);
  } }));
  state.run(`class Value:\n def __init__(self):\n  self.first=True\n def __repr__(self):\n  if self.first:\n   self.first=False\n   fail()\n  return 'ok'\nitems=${kind}([Value()])\nresult=recover(items.__repr__)\n`);
  expect(state.globals.get("result")).toEqual(state.v.string(kind === "set" ? "{ok}" : "frozenset({ok})")); expect(state.calls.depth).toBe(0);
  expect(() => state.run("items.__repr__(1)\n")).toThrow("expected 0 arguments, got 1");
  expect(() => state.run("items.__repr__(x=1)\n")).toThrow("wrapper __repr__() takes no keyword arguments");
  expect(() => state.run("items.__format__('x')\n")).toThrow(`unsupported format string passed to ${kind}.__format__`);
});

it("snapshots set members before guest representation mutates storage", () => {
  const state = fixture();
  state.run("class Value:\n def __init__(self,name):\n  self.name=name\n def __repr__(self):\n  visit(self.name)\n  items.clear()\n  return self.name\nitems={Value('first'),Value('second')}\nresult=f'{items!r}'\nempty=f'{items!r}'\n");
  expect(state.globals.get("result")).toEqual(state.v.string("{first, second}")); expect(state.events).toEqual(["first", "second"]); expect(state.globals.get("empty")).toEqual(state.v.string("set()"));
});

it.each([["(Value(),)", "(guest,)"], ["{'key':Value()}", "{'key': guest}"]])("uses active guest repr in explicit container representation %s", (source, expected) => {
  const state = fixture(); state.run(`class Value:\n def __repr__(self):\n  visit('repr')\n  return 'guest'\nitems=${source}\nresult=items.__repr__()\ntext=items.__str__()\n`);
  expect(state.globals.get("result")).toEqual(state.v.string(expected)); expect(state.globals.get("text")).toEqual(state.v.string(expected)); expect(state.events).toEqual(["repr", "repr"]);
});

it.each(["staticmethod", "classmethod"] as const)("represents %s payloads and subclasses through active guest repr", kind => {
  const state = fixture(); state.globals.set(kind, state.registry.methodDecoratorType(kind));
  state.run(`class Value:\n def __repr__(self):\n  visit('repr')\n  return 'guest'\nclass Child(${kind}):\n pass\nitem=${kind}(Value())\nchild=Child(Value())\nresult=f'{item!r}'\nexplicit=item.__repr__()\ntext=item.__str__()\nformatted=item.__format__('')\nsub=f'{child!r}'\nempty=${kind}.__new__(${kind})\nuninitialized=f'{empty!r}'\n`);
  for (const name of ["result", "explicit", "text", "formatted", "sub"]) expect(state.globals.get(name)).toEqual(state.v.string(`<${kind}(guest)>`));
  expect(state.globals.get("uninitialized")).toEqual(state.v.string(`<${kind}(None)>`)); expect(state.events).toEqual(Array(5).fill("repr"));
});

it.each(["staticmethod", "classmethod"] as const)("explicit %s repr bypasses only the outer subclass override", kind => {
  const state = fixture(); state.globals.set(kind, state.registry.methodDecoratorType(kind));
  state.run(`class Child(${kind}):\n def __repr__(self):\n  return 'override'\nitem=Child(1)\nresult=f'{item!r}'\nbase=${kind}.__repr__(item)\n`);
  expect(state.globals.get("result")).toEqual(state.v.string("override")); expect(state.globals.get("base")).toEqual(state.v.string(`<${kind}(1)>`));
});

it.each(["staticmethod", "classmethod"] as const)("preserves %s payload representation across reinitialization", kind => {
  const state = fixture(); state.globals.set(kind, state.registry.methodDecoratorType(kind));
  state.run(`class Value:\n def __repr__(self):\n  item.__init__(2)\n  return 'original'\nitem=${kind}(Value())\nresult=f'{item!r}'\nagain=f'{item!r}'\n`);
  expect(state.globals.get("result")).toEqual(state.v.string(`<${kind}(original)>`)); expect(state.globals.get("again")).toEqual(state.v.string(`<${kind}(2)>`));
});

it.each(["staticmethod", "classmethod"] as const)("validates %s repr arguments and guest result types", kind => {
  const state = fixture(); state.globals.set(kind, state.registry.methodDecoratorType(kind));
  state.run(`class Value:\n def __repr__(self):\n  return 42\nitem=${kind}(Value())\n`);
  expect(() => state.run("item.__repr__(1)\n")).toThrow("expected 0 arguments, got 1");
  expect(() => state.run("item.__repr__(x=1)\n")).toThrow("wrapper __repr__() takes no keyword arguments");
  expect(() => state.run("result=f'{item!r}'\n")).toThrow("__repr__ returned non-string (type int)");
});

it.each(["staticmethod", "classmethod"] as const)("limits recursive %s repr and restores the call stack", kind => {
  const state = fixture(); state.globals.set(kind, state.registry.methodDecoratorType(kind));
  state.run(`class Value:\n def __repr__(self):\n  return item.__repr__()\nitem=${kind}(Value())\n`);
  expect(() => state.run("result=f'{item!r}'\n")).toThrow("maximum recursion depth exceeded"); expect(state.calls.depth).toBe(0);
  state.run("item.__init__(1)\nresult=f'{item!r}'\n"); expect(state.globals.get("result")).toEqual(state.v.string(`<${kind}(1)>`));
});

it.each(["staticmethod", "classmethod"] as const)("limits direct native %s representation cycles", kind => {
  const state = fixture(); state.globals.set(kind, state.registry.methodDecoratorType(kind));
  state.run(`item=${kind}(None)\nitem.__init__(item)\n`);
  expect(() => state.run("result=f'{item!r}'\n")).toThrow("maximum recursion depth exceeded"); expect(state.calls.depth).toBe(0);
  state.run("item.__init__(1)\nresult=f'{item!r}'\n"); expect(state.globals.get("result")).toEqual(state.v.string(`<${kind}(1)>`));
});

it("represents bound guest methods through the receiver's active repr", () => {
  const state = fixture();
  state.run("class Value:\n def fn(self):\n  pass\n def __repr__(self):\n  visit('repr')\n  return 'guest'\nitem=Value().fn\nresult=f'{item!r}'\nexplicit=item.__repr__()\ntext=item.__str__()\nformatted=item.__format__('')\n");
  for (const name of ["result", "explicit", "text", "formatted"]) expect(state.globals.get(name)).toEqual(state.v.string("<bound method Value.fn of guest>"));
  expect(state.events).toEqual(["repr", "repr", "repr", "repr"]);
});

it.each([["items.append", "<built-in method append of list object at 0x"], ["items.__repr__", "<method-wrapper '__repr__' of list object at 0x"]])("represents bound native callable %s using receiver identity", (expression, prefix) => {
  const state = fixture(); state.builtins.set("id", createIdBuiltin(state.v, state.meter));
  state.run(`items=[]\nitem=${expression}\nresult=f'{item!r}'\nexplicit=item.__repr__()\ntext=item.__str__()\nformatted=item.__format__('')\naddress=id(items)\nowner=item.__repr__.__objclass__ is type(item)\n`);
  const address = state.globals.get("address"); if (address?.kind !== "int") throw Error("expected identity");
  for (const name of ["result", "explicit", "text", "formatted"]) expect(state.globals.get(name)).toEqual(state.v.string(`${prefix}${address.value.toString(16)}>`));
  expect(state.globals.get("owner")).toBe(state.v.true);
});

it("represents unbound builtins without an object address", () => {
  const state = fixture(); state.run("result=f'{visit!r}'\nexplicit=visit.__repr__()\n");
  expect(state.globals.get("result")).toEqual(state.v.string("<built-in function visit>")); expect(state.globals.get("explicit")).toEqual(state.v.string("<built-in function visit>"));
});

it.each([["item.__name__='fallback'", "fallback"], ["item.__qualname__='qualified'", "qualified"], ["item.__qualname__=42\nitem.__name__='unused'", "?"], ["pass", "?"]])("represents general bound callables with name policy %s", (setup, name) => {
  const state = fixture(); state.builtins.set("bind", state.v.builtinFunction({ name: "bind", invoke(args) { return state.v.boundMethod(args[0], args[1]); } }));
  state.run(`class Callable:\n def __call__(self):\n  pass\nitem=Callable()\n${setup}\nmethod=bind(item,1)\nresult=f'{method!r}'\n`);
  expect(state.globals.get("result")).toEqual(state.v.string(`<bound method ${name} of 1>`));
});

it("propagates original errors from general method name lookup", () => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "name failed");
  state.builtins.set("bind", state.v.builtinFunction({ name: "bind", invoke(args) { return state.v.boundMethod(args[0], args[1]); } }));
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Callable:\n def __call__(self):\n  pass\n def __getattribute__(self,name):\n  visit(name)\n  fail()\nmethod=bind(Callable(),1)\n");
  let caught: unknown; try { state.run("result=f'{method!r}'\n"); } catch (error) { caught = error; }
  expect(caught).toBe(failure); expect(state.events).toEqual(["__qualname__"]);
});

it("validates guest receiver repr results while representing a method", () => {
  const state = fixture(); state.run("class Value:\n def fn(self):\n  pass\n def __repr__(self):\n  return 42\nmethod=Value().fn\n");
  expect(() => state.run("result=f'{method!r}'\n")).toThrow("__repr__ returned non-string (type int)");
});

it("captures a method's name before receiver representation mutates it", () => {
  const state = fixture(); state.run("class Value:\n def fn(self):\n  pass\n def __repr__(self):\n  Value.fn.__qualname__='changed'\n  return 'guest'\nmethod=Value().fn\nresult=f'{method!r}'\nagain=f'{method!r}'\n");
  expect(state.globals.get("result")).toEqual(state.v.string("<bound method Value.fn of guest>")); expect(state.globals.get("again")).toEqual(state.v.string("<bound method changed of guest>"));
});

it("validates bound-callable repr arguments", () => {
  const state = fixture(); state.run("method=[].append.__repr__\n");
  expect(() => state.run("method(1)\n")).toThrow("expected 0 arguments, got 1");
  expect(() => state.run("method(x=1)\n")).toThrow("wrapper __repr__() takes no keyword arguments");
});

it("represents functions with live qualified names and execution identities", () => {
  const state = fixture(); state.builtins.set("id", createIdBuiltin(state.v, state.meter));
  state.run("def fn():\n pass\nfn.__qualname__='Outer.fn'\nfn.__name__='other'\nfn.__module__='ignored'\nresult=f'{fn!r}'\nexplicit=fn.__repr__()\ntext=fn.__str__()\nformatted=fn.__format__('')\naddress=id(fn)\n");
  const address = state.globals.get("address"); if (address?.kind !== "int") throw Error("expected identity");
  const expected = state.v.string(`<function Outer.fn at 0x${address.value.toString(16)}>`);
  for (const name of ["result", "explicit", "text", "formatted"]) expect(state.globals.get(name)).toEqual(expected);
  state.run("fn.__qualname__='changed'\nchanged=f'{fn!r}'\n"); expect(state.globals.get("changed")).toEqual(state.v.string(`<function changed at 0x${address.value.toString(16)}>`));
});

it("function dictionary repr shadows only explicit attribute access", () => {
  const state = fixture(); state.builtins.set("id", createIdBuiltin(state.v, state.meter));
  state.run("def fn():\n pass\nfn.__repr__=lambda: 'shadow'\nexplicit=fn.__repr__()\nnormal=f'{fn!r}'\naddress=id(fn)\n");
  const address = state.globals.get("address"); if (address?.kind !== "int") throw Error("expected identity");
  expect(state.globals.get("explicit")).toEqual(state.v.string("shadow")); expect(state.globals.get("normal")).toEqual(state.v.string(`<function fn at 0x${address.value.toString(16)}>`));
});

it.each([
  ["type([]).append", "<method 'append' of 'list' objects>"],
  ["object.__dict__['__init_subclass__']", "<method '__init_subclass__' of 'object' objects>"],
  ["object.__repr__", "<slot wrapper '__repr__' of 'object' objects>"],
  ["object.__dict__['__class__']", "<attribute '__class__' of 'object' objects>"],
  ["Value.slot", "<member 'slot' of 'Value' objects>"]
])("represents native descriptor %s with canonical slot binding", (expression, expected) => {
  const state = fixture(); state.run(`class Value:\n __slots__=('slot',)\nitem=${expression}\nresult=f'{item!r}'\nexplicit=item.__repr__()\ntext=item.__str__()\nformatted=item.__format__('')\nowner=item.__repr__.__objclass__ is type(item)\n`);
  for (const name of ["result", "explicit", "text", "formatted"]) expect(state.globals.get(name)).toEqual(state.v.string(expected));
  expect(state.globals.get("owner")).toBe(state.v.true);
});

it("validates specialized descriptor repr arguments", () => {
  const state = fixture(); state.run("def fn():\n pass\nmethod=fn.__repr__\n");
  expect(() => state.run("method(1)\n")).toThrow("expected 0 arguments, got 1");
  expect(() => state.run("method(x=1)\n")).toThrow("wrapper __repr__() takes no keyword arguments");
});

it("shares an explicit execution identity policy between repr and default id", () => {
  const state = fixture({ id: () => 0xabcden }); state.builtins.set("id", createIdBuiltin(state.v, state.meter));
  state.run("item=object()\nresult=object.__repr__(item)\naddress=id(item)\n");
  expect(state.globals.get("result")).toEqual(state.v.string("<object object at 0xabcde>")); expect(state.globals.get("address")).toEqual(state.v.integer(0xabcden));
});

it("represents ordinary guest objects with stable execution identities", () => {
  const state = fixture(); state.builtins.set("id", createIdBuiltin(state.v, state.meter));
  state.run("class Value:\n pass\nitem=Value()\nfirst=object.__repr__(item)\nnormal=f'{item!r}'\ntext=f'{item}'\naddress=id(item)\nother=Value()\nother_address=id(other)\n");
  const address = state.globals.get("address"); if (address?.kind !== "int") throw Error("expected identity");
  const expected = state.v.string(`<example.Value object at 0x${address.value.toString(16)}>`);
  expect(state.globals.get("first")).toEqual(expected); expect(state.globals.get("normal")).toEqual(expected); expect(state.globals.get("text")).toEqual(expected); expect(state.globals.get("other_address")).not.toEqual(address);
  state.run("again=object.__repr__(item)\n"); expect(state.globals.get("again")).toEqual(expected);
});

it.each([["'example'", "example.Outer.Inner"], ["'builtins'", "Value"], ["''", ".Outer.Inner"], ["None", "Value"], ["42", "Value"]])("reads owned object repr metadata for module %s", (module, name) => {
  const state = fixture(); state.builtins.set("id", createIdBuiltin(state.v, state.meter));
  state.run(`class Value:\n pass\nValue.__qualname__='Outer.Inner'\nValue.__module__=${module}\nitem=Value()\nresult=object.__repr__(item)\naddress=id(item)\n`);
  const address = state.globals.get("address"); if (address?.kind !== "int") throw Error("expected identity");
  expect(state.globals.get("result")).toEqual(state.v.string(`<${name} object at 0x${address.value.toString(16)}>`));
});

it("explicit object repr bypasses guest repr overrides", () => {
  const state = fixture(); state.builtins.set("id", createIdBuiltin(state.v, state.meter));
  state.run("class Value:\n def __repr__(self):\n  visit('repr')\n  return 'override'\nitem=Value()\nresult=object.__repr__(item)\naddress=id(item)\nnormal=f'{item!r}'\n");
  const address = state.globals.get("address"); if (address?.kind !== "int") throw Error("expected identity");
  expect(state.globals.get("result")).toEqual(state.v.string(`<example.Value object at 0x${address.value.toString(16)}>`)); expect(state.globals.get("normal")).toEqual(state.v.string("override")); expect(state.events).toEqual(["repr"]);
});

it("validates the base object repr wrapper before representation", () => {
  const state = fixture(); state.run("item=object()\nmethod=item.__repr__\nowner=method.__objclass__ is object\n");
  expect(state.globals.get("owner")).toBe(state.v.true);
  expect(() => state.run("method(1)\n")).toThrow("expected 0 arguments, got 1");
  expect(() => state.run("method(x=1)\n")).toThrow("wrapper __repr__() takes no keyword arguments");
});

it.each(["exact", "subclass"])("inherits object str with active %s list element representations", kind => {
  const state = fixture();
  state.run(`class Member:\n def __repr__(self):\n  visit('repr')\n  return 'member'\nclass Child(type([])):\n pass\nitems=${kind === "exact" ? "[Member()]" : "Child([Member()])"}\nresult=items.__str__()\nbase=object.__str__(items)\nowner=items.__str__.__objclass__ is object\n`);
  expect(state.globals.get("result")).toEqual(state.v.string("[member]")); expect(state.globals.get("base")).toEqual(state.v.string("[member]")); expect(state.globals.get("owner")).toBe(state.v.true); expect(state.events).toEqual(["repr", "repr"]);
});

it("explicit object str bypasses str overrides and preserves raw repr results", () => {
  const state = fixture();
  state.run("text='value'\nclass Value:\n def __str__(self):\n  visit('str')\n  return 'override'\n def __repr__(self):\n  visit('repr')\n  return text\nitem=Value()\nresult=object.__str__(item)\nsame=result is text\ntext=42\nraw=object.__str__(item)\n");
  expect(state.globals.get("same")).toBe(state.v.true); expect(state.globals.get("raw")).toEqual(state.v.integer(42n)); expect(state.events).toEqual(["repr", "repr"]);
  expect(() => state.run("result=f'{item!r}'\n")).toThrow("__repr__ returned non-string");
});

it("inherits object str through list subclass repr overrides and recursive storage", () => {
  const state = fixture();
  state.run("class Child(type([])):\n def __repr__(self):\n  return 'custom'\nresult=Child().__str__()\nitems=[]\nitems.append(items)\ncycle=items.__str__()\n");
  expect(state.globals.get("result")).toEqual(state.v.string("custom")); expect(state.globals.get("cycle")).toEqual(state.v.string("[[...]]"));
});

it("validates explicit object str wrapper arguments", () => {
  const state = fixture(); state.run("items=[]\nmethod=items.__str__\n");
  expect(() => state.run("method(1)\n")).toThrow("expected 0 arguments, got 1");
  expect(() => state.run("method(x=1)\n")).toThrow("wrapper __str__() takes no keyword arguments");
});

it.each(["exact", "subclass"])("represents %s list contents using live guest repr slots", kind => {
  const state = fixture();
  state.run(`class Member:\n def __repr__(self):\n  visit('repr')\n  return 'member'\nclass Child(type([])):\n pass\nitems=${kind === "exact" ? "[Member()]" : "Child([Member()])"}\nresult=items.__repr__()\nbase=type([]).__repr__(items)\n`);
  expect(state.globals.get("result")).toEqual(state.v.string("[member]")); expect(state.globals.get("base")).toEqual(state.v.string("[member]")); expect(state.events).toEqual(["repr", "repr"]);
});

it.each(["exact", "subclass"])("shares recursion guards for explicit %s list repr", kind => {
  const state = fixture();
  state.run(`class Child(type([])):\n pass\nitems=${kind === "exact" ? "[]" : "Child()"}\nitems.append(items)\nresult=items.__repr__()\n`);
  expect(state.globals.get("result")).toEqual(state.v.string("[[...]]"));
});

it("keeps list subclass repr overrides separate from explicit native repr", () => {
  const state = fixture();
  state.run("class Child(type([])):\n def __repr__(self):\n  return 'custom'\nitems=Child([1,2])\nresult=items.__repr__()\nbase=type([]).__repr__(items)\nnested=[items].__repr__()\n");
  expect(state.globals.get("result")).toEqual(state.v.string("custom")); expect(state.globals.get("base")).toEqual(state.v.string("[1, 2]")); expect(state.globals.get("nested")).toEqual(state.v.string("[custom]"));
});

it("shares list recursion state between implicit formatting and explicit repr reentry", () => {
  const state = fixture();
  state.run("class Child(type([])):\n pass\nclass Member:\n def __repr__(self):\n  return type([]).__repr__(items)\nitems=Child([Member()])\nresult=f'{items!r}'\n");
  expect(state.globals.get("result")).toEqual(state.v.string("[[...]]"));
});

it("inherits base object formatting for list subclasses", () => {
  const state = fixture(); state.run("class Child(type([])):\n pass\nitems=Child([1,2])\nresult=f'{items}'\nbase=object.__format__(items,'')\n");
  expect(state.globals.get("result")).toEqual(state.v.string("[1, 2]")); expect(state.globals.get("base")).toEqual(state.v.string("[1, 2]"));
  expect(() => state.run("object.__format__(items,'x')\n")).toThrow("unsupported format string passed to Child.__format__");
});

it("base object formatting bypasses overridden format and preserves str result identity", () => {
  const state = fixture();
  state.run("text='value'\nclass Value:\n def __str__(self):\n  visit('str')\n  return text\n def __format__(self,spec):\n  visit('format')\n  return 'override'\nitem=Value()\nresult=object.__format__(item,'')\nsame=result is text\n");
  expect(state.globals.get("same")).toBe(state.v.true); expect(state.events).toEqual(["str"]);
  expect(() => state.run("object.__format__(item,'x')\n")).toThrow("unsupported format string passed to Value.__format__"); expect(state.events).toEqual(["str"]);
});

it.each([["", "object.__format__() takes exactly one argument (0 given)"], ["1", "__format__() argument must be str, not int"], ["'',1", "object.__format__() takes exactly one argument (2 given)"], ["x=1", "object.__format__() takes no keyword arguments"]])("validates base object format arguments: %s", (args, message) => {
  expect(() => fixture().run(`object.__format__([]${args ? "," + args : ""})\n`)).toThrow(message);
});

it("reads live list storage while guest element repr mutates it", () => {
  const state = fixture();
  state.run("class Member:\n def __repr__(self):\n  items.append(2)\n  return 'member'\nclass Child(type([])):\n pass\nitems=Child([Member()])\nresult=items.__repr__()\n");
  expect(state.globals.get("result")).toEqual(state.v.string("[member, 2]"));
});

it("restores shared list repr guards after original guest errors", () => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.builtins.set("recover", state.v.builtinFunction({ name: "recover", invoke(args, _keywords, _meter, invocation) {
    if (invocation === undefined) throw Error("expected invocation");
    let thrown: unknown;
    try { invocation.call(args[0], []); } catch (error) { thrown = error; }
    expect(thrown).toBe(failure);
    return invocation.call(args[0], []);
  } }));
  state.run("class Member:\n def __init__(self):\n  self.first=True\n def __repr__(self):\n  if self.first:\n   self.first=False\n   fail()\n  return 'ok'\nclass Child(type([])):\n pass\nitems=Child([Member()])\nresult=recover(items.__repr__)\n");
  expect(state.globals.get("result")).toEqual(state.v.string("[ok]")); expect(state.calls.depth).toBe(0);
});

it("exposes canonical list repr metadata and argument errors", () => {
  const state = fixture(); state.run("items=[]\nmethod=items.__repr__\nreceiver=method.__self__ is items\n");
  expect(state.globals.get("receiver")).toBe(state.v.true);
  expect(() => state.run("method(1)\n")).toThrow("expected 0 arguments, got 1");
  expect(() => state.run("method(x=1)\n")).toThrow("wrapper __repr__() takes no keyword arguments");
});

it("allocates list subclasses with native contents and independent instance dictionaries", () => {
  const state = fixture();
  state.run("list_type=type([])\nclass Child(list_type):\n pass\nitems=Child([1,2])\nitems.label=7\nitems.append(3)\ncorrect=type(items) is Child\nlabel=items.label\nresult=0\nfor item in items:\n result=result*10+item\n");
  expect(state.globals.get("correct")).toBe(state.v.true); expect(state.globals.get("label")).toEqual(state.v.integer(7)); expect(state.globals.get("result")).toEqual(state.v.integer(123));
});

it("keeps list subclass overrides separate from explicit native slots", () => {
  const state = fixture();
  state.run("list_type=type([])\nclass Child(list_type):\n def __len__(self):\n  return 9\n def __iter__(self):\n  return [7].__iter__()\n def __getitem__(self,key):\n  return 8\nitems=Child([1,2])\nlength=items.__len__()\nnative_length=list_type.__len__(items)\nitem=items[0]\nnative_item=list_type.__getitem__(items,0)\nresult=0\nfor value in items:\n result=result*10+value\n");
  expect(state.globals.get("length")).toEqual(state.v.integer(9)); expect(state.globals.get("native_length")).toEqual(state.v.integer(2)); expect(state.globals.get("item")).toEqual(state.v.integer(8)); expect(state.globals.get("native_item")).toEqual(state.v.integer(1)); expect(state.globals.get("result")).toEqual(state.v.integer(7));
});

it("retains list subclass identity for in-place operations and exact list results for copies", () => {
  const state = fixture();
  state.run("list_type=type([])\nclass Child(list_type):\n pass\nitems=Child([1,2])\nother=Child([3])\njoined=items+other\ncopy=items.copy()\nrepeated=items*2\nalias=items\nitems+=other\nitems*=2\nsame=items is alias\nexact=type(joined) is list_type and type(copy) is list_type and type(repeated) is list_type\nresult=0\nfor value in items:\n result=result*10+value\nequal=items==[1,2,3,1,2,3]\n");
  expect(state.globals.get("same")).toBe(state.v.true); expect(state.globals.get("exact")).toBe(state.v.true); expect(state.globals.get("equal")).toBe(state.v.true); expect(state.globals.get("result")).toEqual(state.v.integer(123123));
});

it("stores declared slots alongside native list contents", () => {
  const state = fixture();
  state.run("list_type=type([])\nclass Child(list_type):\n __slots__=('label',)\nitems=Child([1])\nitems.label=7\nlabel=items.label\nitem=items[0]\n");
  expect(state.globals.get("label")).toEqual(state.v.integer(7)); expect(state.globals.get("item")).toEqual(state.v.integer(1));
  expect(() => state.run("items.extra=1\n")).toThrow("has no attribute 'extra'");
});

it("concatenates exact lists with list subclass payloads after reflected negotiation", () => {
  const state = fixture();
  state.run("list_type=type([])\nclass Child(list_type):\n pass\nclass Reflected(Child):\n def __radd__(self,other):\n  return 9\nitems=[1]+Child([2])\nresult=items[0]*10+items[1]\nreflected=[1]+Reflected([2])\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(12)); expect(state.globals.get("reflected")).toEqual(state.v.integer(9));
});

it("runs overridden list subclass initialization without implicit base initialization", () => {
  const state = fixture();
  state.run("class Child(type([])):\n def __init__(self,*,value):\n  self.append(value)\nitems=Child(value=7)\nresult=items[0]\nlength=items.__len__()\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(7)); expect(state.globals.get("length")).toEqual(state.v.integer(1));
  expect(() => state.run("items.native\n")).toThrow("has no attribute 'native'");
});

it.each(["items*1.0", "1.0*items", "items*=1.0"])("uses sequence repetition errors for list subclass expressions: %s", expression => {
  const state = fixture(); state.run("class Child(type([])):\n pass\nitems=Child([1,2])\n");
  expect(() => state.run(`${expression}\n`)).toThrow("can't multiply sequence by non-int of type 'float'");
  expect(() => state.run("items.__mul__(1.0)\n")).toThrow("'float' object cannot be interpreted as an integer");
});

it("retains native subclass concatenation errors for unrelated instances", () => {
  const state = fixture(); state.run("class Child(type([])):\n pass\nclass Other:\n pass\nitems=Child([1])\n");
  expect(() => state.run("items+Other()\n")).toThrow('can only concatenate list (not "Other") to list');
});

it("runs inherited subclass in-place concatenation before reflected addition", () => {
  const state = fixture(); state.run("class Child(type([])):\n pass\nclass Other:\n def __radd__(self,other):\n  visit('reflected')\n  return 9\nitems=Child([1])\n");
  expect(() => state.run("items+=Other()\n")).toThrow("'Other' object is not iterable"); expect(state.events).toEqual([]);
});

it.each(["__add__", "__mul__"])("does not restore a native sequence fallback after %s declines", name => {
  const state = fixture(), operator = name === "__add__" ? "+" : "*";
  state.globals.set("NotImplemented", state.v.notImplemented);
  state.run(`class Child(type([])):\n def ${name}(self,other):\n  return NotImplemented\nclass Other:\n def __index__(self):\n  visit('index')\n  return 2\nitems=Child([1])\n`);
  expect(() => state.run(`items${operator}Other()\n`)).toThrow(`unsupported operand type(s) for ${operator}: 'Child' and 'Other'`); expect(state.events).toEqual([]);
});

it.each(["+=", "*="])("uses ordinary result identity after a list subclass %s override declines", operator => {
  const state = fixture(), name = operator === "+=" ? "__iadd__" : "__imul__", argument = operator === "+=" ? "[2]" : "2";
  state.globals.set("NotImplemented", state.v.notImplemented);
  state.run(`class Child(type([])):\n def ${name}(self,other):\n  return NotImplemented\nitems=Child([1])\nalias=items\nitems${operator}${argument}\nsame=items is alias\nexact=type(items) is type([])\n`);
  expect(state.globals.get("same")).toBe(state.v.false); expect(state.globals.get("exact")).toBe(state.v.true);
});

it.each([["__mul__", "[1]*Child([1])", "list"], ["__rmul__", "Child([1])*Child([1])", "Child"], ["__rmul__", "Child([1])*[1]", "list"]])("activates paired numeric repetition when %s is overridden", (name, expression, type) => {
  const state = fixture(); state.globals.set("NotImplemented", state.v.notImplemented);
  state.run(`class Child(type([])):\n def ${name}(self,other):\n  return NotImplemented\n`);
  expect(() => state.run(`${expression}\n`)).toThrow(`'${type}' object cannot be interpreted as an integer`);
});

it.each(["append", "__len__", "__init__"])("binds inherited %s to the list subclass instance, not its payload", name => {
  const state = fixture();
  state.run(`class Child(type([])):\n pass\nitems=Child()\nreceiver=items.${name}.__self__ is items\n`);
  expect(state.globals.get("receiver")).toBe(state.v.true);
});

it.each(["", "[3,4]", "Source()"])("constructs exact native lists through the normal type lifecycle: %s", args => {
  const state = fixture();
  state.run(`class Source:\n def __iter__(self):\n  visit('iterate')\n  return [3,4].__iter__()\nlist_type=type([])\nitems=list_type(${args})\ncorrect_type=type(items) is list_type\nresult=0\nfor item in items:\n result=result*10+item\n`);
  expect(state.globals.get("correct_type")).toBe(state.v.true); expect(state.globals.get("result")).toEqual(state.v.integer(args === "" ? 0 : 34)); expect(state.events).toEqual(args === "Source()" ? ["iterate"] : []);
});

it("allocates fresh empty lists without initializing supplied new arguments", () => {
  const state = fixture();
  state.run("list_type=type([])\nfirst=list_type.__new__(list_type,[1,2],3,x=4)\nsecond=list_type.__new__(list_type)\ndistinct=first is not second\nlength=first.__len__()\n");
  expect(state.globals.get("distinct")).toBe(state.v.true); expect(state.globals.get("length")).toEqual(state.v.integer(0));
});

it.each([["", "list.__new__(): not enough arguments"], ["1", "list.__new__(X): X is not a type object (int)"], ["object", "list.__new__(object): object is not a subtype of list"]])("validates native list allocator receivers: %s", (args, message) => {
  expect(() => fixture().run(`type([]).__new__(${args})\n`)).toThrow(message);
});

it("rejects foreign registry types at the list allocation boundary", () => {
  const state = fixture(); state.globals.set("foreign", fixture().registry.listType());
  expect(() => state.run("type([]).__new__(foreign)\n")).toThrow("type is not owned by this list allocator");
  expect(state.calls.depth).toBe(0);
});

it("preserves original initializer failures through list type calls", () => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Source:\n def __iter__(self):\n  fail()\n");
  let thrown: unknown;
  try { state.run("type([])(Source())\n"); } catch (error) { thrown = error; }
  expect(thrown).toBe(failure); expect(state.calls.depth).toBe(0);
});

it.each(["", "items", "[3,4]"])("reinitializes list storage through direct and bound slots: %s", args => {
  for (const direct of [false, true]) {
    const state = fixture(), call = direct ? `type(items).__init__(items${args ? "," + args : ""})` : `items.__init__(${args})`;
    state.run(`items=[1,2]\nanswer=${call}\nresult=0\nfor value in items:\n result=result*10+value\n`);
    expect(state.globals.get("answer")).toBe(state.v.none); expect(state.globals.get("result")).toEqual(state.v.integer(args === "[3,4]" ? 34 : 0));
  }
});

it("clears list storage before acquiring a guest initialization iterator", () => {
  const state = fixture();
  state.run("class Source:\n def __iter__(self):\n  if items==[]:\n   visit('empty')\n  return [3,4].__iter__()\nitems=[1,2]\nitems.__init__(Source())\nresult=items[0]*10+items[1]\n");
  expect(state.events).toEqual(["empty"]); expect(state.globals.get("result")).toEqual(state.v.integer(34));
});

it.each([["1,2", "list expected at most 1 argument, got 2"], ["x=1", "list() takes no keyword arguments"]])("validates list initializer arguments before clearing: %s", (args, message) => {
  const state = fixture(); state.run("items=[1,2]\n");
  expect(() => state.run(`items.__init__(${args})\n`)).toThrow(message);
  state.run("result=items[0]*10+items[1]\n"); expect(state.globals.get("result")).toEqual(state.v.integer(12));
});

it("leaves list storage empty when initialization receives a noniterable", () => {
  const state = fixture(); state.run("items=[1,2]\n");
  expect(() => state.run("type(items).__init__(items,1)\n")).toThrow("'int' object is not iterable");
  state.run("length=items.__len__()\n"); expect(state.globals.get("length")).toEqual(state.v.integer(0));
});

it.each(["iterate", "hint", "next"])("preserves original %s errors and initialization progress", phase => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run(`class Source:\n def __init__(self):\n  self.first=True\n def __iter__(self):\n  ${phase === "iterate" ? "fail()" : "return self"}\n def __len__(self):\n  ${phase === "hint" ? "fail()" : "return 2"}\n def __next__(self):\n  if self.first:\n   self.first=False\n   return 3\n  fail()\nitems=[1,2]\n`);
  let thrown: unknown;
  try { state.run("items.__init__(Source())\n"); } catch (error) { thrown = error; }
  expect(thrown).toBe(failure); expect(state.calls.depth).toBe(0);
  state.run("result=0\nfor value in items:\n result=result*10+value\n"); expect(state.globals.get("result")).toEqual(state.v.integer(phase === "next" ? 3 : 0));
});

it("exposes canonical list initialization wrapper metadata", () => {
  const state = fixture(); state.run("items=[]\nmethod=items.__init__\nreceiver=method.__self__ is items\nname=method.__name__\n");
  expect(state.globals.get("receiver")).toBe(state.v.true); expect(state.globals.get("name")).toEqual(state.v.string("__init__"));
});

it.each(["__add__", "__iadd__", "__mul__", "__rmul__", "__imul__"])("exposes list %s with native result identity and guest conversion", name => {
  for (const direct of [false, true]) {
    const state = fixture(), argument = name === "__add__" ? "[3]" : name === "__iadd__" ? "Extra()" : "Count()";
    const call = direct ? `type(items).${name}(items,${argument})` : `items.${name}(${argument})`;
    state.run(`class Count:\n def __index__(self):\n  visit('index')\n  return 2\nclass Extra:\n def __iter__(self):\n  visit('iterate')\n  return [3].__iter__()\nitems=[1,2]\nanswer=${call}\nsame=answer is items\nresult=0\nfor item in answer:\n result=result*10+item\n`);
    expect(state.globals.get("same")).toBe(name === "__iadd__" || name === "__imul__" ? state.v.true : state.v.false);
    expect(state.globals.get("result")).toEqual(state.v.integer(name === "__add__" || name === "__iadd__" ? 123 : 1212));
    expect(state.events).toEqual(name === "__add__" ? [] : name === "__iadd__" ? ["iterate"] : ["index"]);
  }
});

it.each(["__add__", "__iadd__", "__mul__", "__rmul__", "__imul__"])("publishes canonical list %s metadata and argument validation", name => {
  const state = fixture(); state.run(`items=[]\nmethod=items.${name}\nreceiver=method.__self__ is items\n`);
  expect(state.globals.get("receiver")).toBe(state.v.true);
  expect(() => state.run("method()\n")).toThrow("expected 1 argument, got 0");
  expect(() => state.run("method(x=1)\n")).toThrow(`wrapper ${name}() takes no keyword arguments`);
});

it.each(["__mul__", "__rmul__", "__imul__"])("reports original operand type for %s overflow", name => {
  const state = fixture(); state.run("class Count:\n def __index__(self):\n  return 1<<100\nitems=[]\n");
  expect(() => state.run(`items.${name}(Count())\n`)).toThrow("cannot fit 'Count' into an index-sized integer");
});

it("retains native addition diagnostics without an invocation type policy", () => {
  const state = fixture(), slot = state.registry.listType().value.namespace.items.lookup(state.v.string("__add__"))?.value;
  if (slot?.kind !== "wrapper_descriptor") throw Error("expected wrapper");
  expect(() => slot.value.invoke(state.v.list([]), [state.v.none], state.v.dictionary(new OrderedKeyMap(state.keys, state.meter)), state.meter)).toThrow('can only concatenate list (not "NoneType") to list');
});

it.each(["__mul__", "__rmul__", "__imul__"])("preserves original guest index errors in %s", name => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Count:\n def __index__(self):\n  fail()\nitems=[1,2]\n");
  let thrown: unknown;
  try { state.run(`items.${name}(Count())\n`); } catch (error) { thrown = error; }
  expect(thrown).toBe(failure); expect(state.calls.depth).toBe(0);
});

it("preserves partial list extension and the original iterator error through __iadd__", () => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Cursor:\n def __init__(self):\n  self.first=True\n def __iter__(self):\n  return self\n def __next__(self):\n  if self.first:\n   self.first=False\n   return 3\n  fail()\nitems=[1,2]\n");
  let thrown: unknown;
  try { state.run("type(items).__iadd__(items,Cursor())\n"); } catch (error) { thrown = error; }
  expect(thrown).toBe(failure); expect(state.calls.depth).toBe(0);
  state.run("result=items[0]*100+items[1]*10+items[2]\n"); expect(state.globals.get("result")).toEqual(state.v.integer(123));
});

it.each(["direct", "bound"])("reads list subscriptions through %s native descriptors and guest indices", mode => {
  const state = fixture(), call = mode === "direct" ? "type(items).__getitem__(items,index)" : "items.__getitem__(index)";
  state.run(`class Index:\n def __index__(self):\n  visit('index')\n  items.append(3)\n  return -1\nitems=[1,2]\nindex=Index()\nresult=${call}\n`);
  expect(state.globals.get("result")).toEqual(state.v.integer(3)); expect(state.events).toEqual(["index"]);
});

it.each(["direct", "bound"])("mutates list subscriptions through %s native descriptors and guest indices", mode => {
  const state = fixture(), set = mode === "direct" ? "type(items).__setitem__(items,index,9)" : "items.__setitem__(index,9)", del = mode === "direct" ? "type(items).__delitem__(items,index)" : "items.__delitem__(index)";
  state.run(`class Index:\n def __index__(self):\n  visit('index')\n  return -1\nitems=[1,2,3]\nindex=Index()\nassigned=${set}\nvalue=items[-1]\ndeleted=${del}\nlength=items.__len__()\n`);
  expect(state.globals.get("assigned")).toBe(state.v.none); expect(state.globals.get("deleted")).toBe(state.v.none); expect(state.globals.get("value")).toEqual(state.v.integer(9)); expect(state.globals.get("length")).toEqual(state.v.integer(2)); expect(state.events).toEqual(["index", "index"]);
});

it.each(["__getitem__", "__setitem__", "__delitem__"])("publishes canonical list %s binding metadata", name => {
  const state = fixture(); state.run(`items=[]\nmethod=items.${name}\nreceiver=method.__self__ is items\nname=method.__name__\n`);
  expect(state.globals.get("receiver")).toBe(state.v.true); expect(state.globals.get("name")).toEqual(state.v.string(name));
});

it.each(["direct", "bound"])("uses guest slice replacements and independent slice reads through %s slots", mode => {
  const state = fixture(); state.globals.set("key", state.v.slice({ lower: state.v.integer(1), upper: state.v.integer(3) }));
  const call = (name: string, extra = "") => mode === "direct" ? `type(items).${name}(items,key${extra})` : `items.${name}(key${extra})`;
  state.run(`class Replacement:\n def __iter__(self):\n  visit('iterate')\n  items.append(4)\n  return [7,8].__iter__()\nitems=[1,2,3]\ncopied=${call("__getitem__")}\nassigned=${call("__setitem__", ",Replacement()")}\nresult=0\nfor value in items:\n result=result*10+value\ndeleted=${call("__delitem__")}\nremaining=0\nfor value in items:\n remaining=remaining*10+value\ncopy_result=copied[0]*10+copied[1]\n`);
  expect(state.globals.get("result")).toEqual(state.v.integer(1784)); expect(state.globals.get("remaining")).toEqual(state.v.integer(14)); expect(state.globals.get("copy_result")).toEqual(state.v.integer(23)); expect(state.events).toEqual(["iterate"]); expect(state.globals.get("assigned")).toBe(state.v.none); expect(state.globals.get("deleted")).toBe(state.v.none);
});

it.each(["__getitem__", "__setitem__", "__delitem__"])("preserves index errors from explicit list %s", name => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Index:\n def __index__(self):\n  fail()\nitems=[1,2,3]\n");
  let thrown: unknown;
  try { state.run(`items.${name}(Index()${name === "__setitem__" ? ",9" : ""})\n`); } catch (error) { thrown = error; }
  expect(thrown).toBe(failure); expect(state.calls.depth).toBe(0);
});

it.each(["direct", "bound"])("exposes live list length and iteration slots through %s calls", mode => {
  const state = fixture(), length = mode === "direct" ? "type(items).__len__(items)" : "items.__len__()", iterate = mode === "direct" ? "type(items).__iter__(items)" : "items.__iter__()";
  state.run(`items=[1,2]\nbefore=${length}\ncursor=${iterate}\nitems.append(3)\nafter=${length}\nresult=0\nfor value in cursor:\n result=result*10+value\n`);
  expect(state.globals.get("before")).toEqual(state.v.integer(2)); expect(state.globals.get("after")).toEqual(state.v.integer(3)); expect(state.globals.get("result")).toEqual(state.v.integer(123));
});

it.each(["direct", "bound"])("uses live guest equality and truth in %s list contains slots", mode => {
  const state = fixture(), call = mode === "direct" ? "type(items).__contains__(items,needle)" : "items.__contains__(needle)";
  state.run(`class Truth:\n def __bool__(self):\n  visit('truth')\n  return False\nclass Member:\n def __eq__(self,other):\n  visit('equal')\n  items.append(other)\n  return Truth()\nneedle=object()\nitems=[Member()]\nresult=${call}\n`);
  expect(state.globals.get("result")).toBe(state.v.true); expect(state.events).toEqual(["equal", "truth"]);
});

it.each(["__len__", "__iter__", "__contains__"])("retains list %s wrapper metadata and rejects invalid arguments", name => {
  const state = fixture(); state.run(`items=[]\nmethod=items.${name}\nreceiver=method.__self__ is items\nname=method.__name__\n`);
  expect(state.globals.get("receiver")).toBe(state.v.true); expect(state.globals.get("name")).toEqual(state.v.string(name));
  expect(() => state.run(`method(x=1)\n`)).toThrow(`wrapper ${name}() takes no keyword arguments`);
  expect(() => state.run("method(1,2)\n")).toThrow(`expected ${name === "__contains__" ? "1 argument" : "0 arguments"}, got 2`);
});

it("keeps a list slot iterator exhausted after later growth", () => {
  const state = fixture();
  state.run("items=[1,2]\ncursor=items.__iter__()\nfirst=0\nfor value in cursor:\n first=first*10+value\nitems.append(3)\nsecond=0\nfor value in cursor:\n second+=value\n");
  expect(state.globals.get("first")).toEqual(state.v.integer(12)); expect(state.globals.get("second")).toEqual(state.v.integer(0));
});

it.each(["equal", "truth"])("preserves original %s errors and unwinds list membership slots", phase => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run(`class Truth:\n def __bool__(self):\n  fail()\nclass Member:\n def __eq__(self,other):\n  ${phase === "equal" ? "fail()" : "return Truth()"}\nitems=[Member()]\n`);
  let thrown: unknown;
  try { state.run("items.__contains__(object())\n"); } catch (error) { thrown = error; }
  expect(thrown).toBe(failure); expect(state.calls.depth).toBe(0);
});

it.each(["dict", "set"])("dispatches guest key protocols in ordinary %s displays across frames", kind => {
  const state = fixture();
  state.run(`class Key:\n def __hash__(self):\n  visit('hash')\n  return 7\n def __eq__(self,other):\n  visit('equal')\n  return True\nleft=Key()\nright=Key()\ndef make():\n return ${kind === "dict" ? "{left:1}" : "{left}"}\ndef merge(target):\n target|=${kind === "dict" ? "{right:2}" : "{right}"}\nresult=make()\nmerge(result)\nfound=right in result\n`);
  const result = state.globals.get("result")!;
  if (result.kind !== "dict" && result.kind !== "set") throw Error("expected collection");
  expect(result.items.size).toBe(1); expect(state.globals.get("found")).toBe(state.v.true);
  expect(state.events).toEqual(["hash", "hash", "equal", "hash", "equal"]);
});

it("exposes object equality as identity-or-NotImplemented without delegation", () => {
  const state = fixture();
  state.run("class Key:\n def __eq__(self,other):\n  visit('override')\n  return False\nleft=Key()\nright=Key()\nsame=object.__eq__(left,left)\ndifferent=object.__eq__(left,right)\nbound=object.__eq__.__get__(left,Key)(left)\nnative=object.__eq__([],[])\n");
  for (const name of ["same", "bound"]) expect(state.globals.get(name)).toBe(state.v.true);
  for (const name of ["different", "native"]) expect(state.globals.get(name)).toBe(state.v.notImplemented);
  expect(state.events).toEqual([]);
});

it.each(["key.method", "key.__getattribute__", "items.append"])("preserves native bound equality while explicit object equality uses identity for %s", expression => {
  const state = fixture();
  state.run(`class Key:\n def method(self):\n  pass\nkey=Key()\nitems=[]\nleft=${expression}\nright=${expression}\nequal=left==right\nunequal=left!=right\nbase=object.__eq__(left,right)\nslot=type(left).__eq__(left,right)\ndeclined=type(left).__eq__(left,None)\n`);
  expect(state.globals.get("equal")).toBe(state.v.true); expect(state.globals.get("unequal")).toBe(state.v.false);
  expect(state.globals.get("base")).toBe(state.v.notImplemented);
  expect(state.globals.get("slot")).toBe(state.v.true); expect(state.globals.get("declined")).toBe(state.v.notImplemented);
});

it.each(["key.method", "key.__getattribute__", "items.append"])("uses native callable hash slots for %s", expression => {
  const state = fixture(); state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.run(`class Key:\n def method(self):\n  pass\nkey=Key()\nitems=[]\nmethod=${expression}\nnormal=hash(method)\ndirect=type(method).__hash__(method)\nbound=type(method).__hash__.__get__(method,type(method))()\nidentity=object.__hash__(method)\nattribute=method.__hash__()\nequal=method.__eq__(method)\nunequal=method.__ne__(method)\n`);
  expect(state.globals.get("normal")).toEqual(state.v.integer(0)); expect(state.globals.get("direct")).toEqual(state.globals.get("normal"));
  expect(state.globals.get("bound")).toEqual(state.globals.get("normal")); expect(state.globals.get("identity")).toEqual(state.v.integer(17));
  expect(state.globals.get("attribute")).toEqual(state.globals.get("normal")); expect(state.globals.get("equal")).toBe(state.v.true); expect(state.globals.get("unequal")).toBe(state.v.false);
});

it("keeps nested callable hashes guest-aware in explicit native method hashing", () => {
  const state = fixture(); state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.builtins.set("bind", state.v.builtinFunction({ name: "bind", invoke(args) { return state.v.boundMethod(args[0], args[1]); } }));
  state.run("class Callable:\n def __call__(self):\n  pass\n def __hash__(self):\n  visit('hash')\n  return 9\nmethod=bind(Callable(),[])\nnormal=hash(method)\ndirect=type(method).__hash__(method)\n");
  expect(state.globals.get("normal")).toEqual(state.v.integer(24)); expect(state.globals.get("direct")).toEqual(state.v.integer(24)); expect(state.events).toEqual(["hash", "hash"]);
});

it("preserves nested hash exceptions through the native callable slot", () => {
  const state = fixture(), failure = new PythonRuntimeError("TypeError", "sentinel");
  state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.builtins.set("bind", state.v.builtinFunction({ name: "bind", invoke(args) { return state.v.boundMethod(args[0], args[1]); } }));
  state.run("class Callable:\n def __call__(self):\n  pass\n def __hash__(self):\n  fail()\nmethod=bind(Callable(),[])\n");
  for (const source of ["hash(method)\n", "type(method).__hash__(method)\n"]) {
    let thrown: unknown; try { state.run(source); } catch (error) { thrown = error; }
    expect(thrown).toBe(failure); expect(state.calls.depth).toBe(0);
  }
});

it.each([["__eq__", false], ["__ne__", true], ["__lt__", true], ["__le__", true], ["__gt__", false], ["__ge__", false]] as const)("exposes native list comparison %s through direct and ordinary access", (name, expected) => {
  const state = fixture();
  state.run(`left=[1,2]\nright=[1,3]\ndirect=type(left).${name}(left,right)\nbound=left.${name}(right)\ndeclined=left.${name}((1,2))\nhash_slot=left.__hash__\n`);
  expect(state.globals.get("direct")).toBe(state.v.boolean(expected)); expect(state.globals.get("bound")).toBe(state.globals.get("direct"));
  expect(state.globals.get("declined")).toBe(state.v.notImplemented); expect(state.globals.get("hash_slot")).toBe(state.v.none);
});

it("preserves raw guest ordering results and identity shortcuts in list slots", () => {
  const state = fixture();
  state.run("marker=[]\nclass Key:\n def __eq__(self,other):\n  visit('equal')\n  return False\n def __lt__(self,other):\n  visit('less')\n  return marker\nleft=Key()\nright=Key()\nresult=[left].__lt__([right])\nraw=result is marker\nidentity=[left].__eq__([left])\n");
  expect(state.globals.get("raw")).toBe(state.v.true); expect(state.globals.get("identity")).toBe(state.v.true); expect(state.events).toEqual(["equal", "less"]);
});

it("observes live list mutation during explicit comparison", () => {
  const state = fixture();
  state.run("class Key:\n def __eq__(self,other):\n  visit('equal')\n  right.clear()\n  return True\nleft=[Key(),1]\nright=[Key(),2]\nresult=left.__eq__(right)\n");
  expect(state.globals.get("result")).toBe(state.v.false); expect(state.events).toEqual(["equal"]);
});

it.each(["equal", "truth", "less"])("preserves %s exceptions in explicit list comparison", phase => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run(`class Truth:\n def __bool__(self):\n  fail()\nclass Key:\n def __eq__(self,other):\n  ${phase === "equal" ? "fail()" : phase === "truth" ? "return Truth()" : "return False"}\n def __lt__(self,other):\n  fail()\nleft=[Key()]\nright=[Key()]\n`);
  let thrown: unknown; try { state.run("left.__lt__(right)\n"); } catch (error) { thrown = error; }
  expect(thrown).toBe(failure); expect(state.calls.depth).toBe(0);
});

it.each(["items.sort", "type(items).sort"])("sorts through canonical %s with guest key, comparison and reverse truth", callee => {
  const state = fixture();
  state.run(`class Reverse:\n def __bool__(self):\n  visit('reverse')\n  return True\nclass Key:\n def __init__(self,value):\n  self.value=value\n def __lt__(self,other):\n  return self.value<other.value\ndef key(value):\n visit('key')\n return Key(value)\nitems=[1,3,2]\nresult=${callee}(${callee.startsWith("type") ? "items," : ""}key=key,reverse=Reverse())\nfirst=items[0]\nlast=items[2]\n`);
  expect(state.globals.get("result")).toBe(state.v.none); expect(state.globals.get("first")).toEqual(state.v.integer(3)); expect(state.globals.get("last")).toEqual(state.v.integer(1));
  expect(state.events).toEqual(["reverse", "key", "key", "key"]);
});

it("retains temporary-empty semantics through an extracted sort descriptor", () => {
  const state = fixture();
  state.run("items=[1,3,2]\nsorter=items.sort\ndef key(value):\n if items==[]:\n  visit('empty')\n return -value\n");
  state.run("sorter(key=key)\nfirst=items[0]\nlast=items[2]\n");
  expect(state.events).toEqual(["empty", "empty", "empty"]); expect(state.globals.get("first")).toEqual(state.v.integer(3)); expect(state.globals.get("last")).toEqual(state.v.integer(1));
});

it.each(["key", "comparison", "reverse"])("restores the list and preserves %s callback errors during sort", phase => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Key:\n def __lt__(self,other):\n  fail()\nclass Reverse:\n def __bool__(self):\n  fail()\ndef key(value):\n fail()\nitems=[Key(),Key(),Key()]\n");
  let thrown: unknown;
  try { state.run(`type(items).sort(items${phase === "key" ? ",key=key" : phase === "reverse" ? ",reverse=Reverse()" : ""})\n`); } catch (error) { thrown = error; }
  expect(thrown).toBe(failure); expect(state.calls.depth).toBe(0);
  const items = state.globals.get("items")!; if (items.kind !== "list") throw Error("expected list"); expect(items.items.length).toBe(3);
});

it.each([
  ["1", "sort() takes no positional arguments"],
  ["1,2", "sort() takes no positional arguments"],
  ["1,2,3", "sort() takes at most 2 arguments (3 given)"],
  ["1,2,3,key=None", "sort() takes at most 2 arguments (4 given)"],
  ["1,key=None,reverse=False,x=1", "sort() takes at most 2 arguments (4 given)"],
  ["key=None,reverse=False,x=1", "sort() takes at most 2 keyword arguments (3 given)"]
])("validates sort argument counts before keyword-only arguments: %s", (args, message) => {
  expect(() => fixture().run(`[].sort(${args})\n`)).toThrow(message);
});

it.each(["append", "extend", "insert", "pop", "clear", "reverse", "copy", "count", "remove", "index", "__reversed__", "sort"])("retains canonical list %s binding metadata and key identity", name => {
  const state = fixture(); state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.run(`items=[]\nleft=items.${name}\nright=items.${name}\nresult={left:1,right:2}\nequal_hash=hash(left)==hash(right)\nreceiver=left.__self__ is items\nname=left.__name__\nqualified=left.__qualname__\n`);
  const result = state.globals.get("result")!;
  if (result.kind !== "dict") throw Error("expected dictionary");
  expect(result.items.size).toBe(1); expect(state.globals.get("equal_hash")).toBe(state.v.true); expect(state.globals.get("receiver")).toBe(state.v.true);
  expect(state.globals.get("name")).toEqual(state.v.string(name)); expect(state.globals.get("qualified")).toEqual(state.v.string(`list.${name}`));
});

it("calls canonical list descriptors with live guest iteration and equality", () => {
  const state = fixture();
  state.run("class Source:\n def __getitem__(self,index):\n  return [1,2][index]\nclass Key:\n def __eq__(self,other):\n  visit('equal')\n  return True\nitems=[]\ntype(items).extend(items,Source())\ntype(items).append(items,Key())\ncount=items.count(Key())\nsize=items.index(2)\n");
  expect(state.globals.get("count")).toEqual(state.v.integer(3)); expect(state.globals.get("size")).toEqual(state.v.integer(1));
  expect(state.events).toEqual(["equal", "equal", "equal"]);
});

it.each(["__lt__", "__le__", "__gt__", "__ge__"])("exposes non-delegating object ordering slot %s", name => {
  const state = fixture();
  state.run(`class Key:\n def ${name}(self,other):\n  visit('override')\n  return True\nkey=Key()\ndirect=object.${name}(key,key)\nbound=object.${name}.__get__(key,Key)(key)\nnative=object.${name}(1,2)\n`);
  for (const result of ["direct", "bound", "native"]) expect(state.globals.get(result)).toBe(state.v.notImplemented);
  expect(state.events).toEqual([]);
});

it.each(["__lt__", "__le__", "__gt__", "__ge__"])("validates object ordering arguments for %s", name => {
  const state = fixture();
  for (const [args, message] of [
    ["", `descriptor '${name}' of 'object' object needs an argument`],
    ["1", "expected 1 argument, got 0"], ["1,2,3", "expected 1 argument, got 2"],
    ["1,x=2", `wrapper ${name}() takes no keyword arguments`],
    ["1,2,3,x=4", `wrapper ${name}() takes no keyword arguments`]
  ]) expect(() => state.run(`object.${name}(${args})\n`)).toThrow(message);
  expect(state.calls.depth).toBe(0);
});

it("delegates object inequality only to receiver equality and preserves NotImplemented", () => {
  const state = fixture(); state.globals.set("NotImplemented", state.v.notImplemented);
  state.run("class Left:\n def __eq__(self,other):\n  visit('left')\n  return NotImplemented\nclass Right(Left):\n def __eq__(self,other):\n  visit('right')\n  return True\nleft=Left()\nright=Right()\ndirect=object.__ne__(left,right)\nbound=left.__ne__(right)\nnormal=left!=right\nnative=object.__ne__(1,2)\nunsupported=object.__ne__(1,'x')\n");
  expect(state.globals.get("direct")).toBe(state.v.notImplemented); expect(state.globals.get("bound")).toBe(state.v.notImplemented);
  expect(state.globals.get("normal")).toBe(state.v.false); expect(state.globals.get("native")).toBe(state.v.true); expect(state.globals.get("unsupported")).toBe(state.v.notImplemented);
  expect(state.events).toEqual(["left", "left", "right"]);
});

it.each(["1,1.0", "True,1j", "1.0,1j"])("preserves one-sided native numeric comparison for %s", pair => {
  const state = fixture();
  state.run(`result=object.__ne__(${pair})\n`);
  expect(state.globals.get("result")).toBe(state.v.notImplemented);
});

it("uses guest truth for object inequality and complete comparison for native members", () => {
  const state = fixture();
  state.run("class Truth:\n def __bool__(self):\n  visit('truth')\n  return False\nclass Key:\n def __eq__(self,other):\n  visit('equal')\n  return Truth()\n def __ne__(self,other):\n  visit('override')\n  return False\nleft=Key()\nright=Key()\ndirect=object.__ne__(left,right)\nnested=object.__ne__([left],[right])\n");
  expect(state.globals.get("direct")).toBe(state.v.true); expect(state.globals.get("nested")).toBe(state.v.true);
  expect(state.events).toEqual(["equal", "truth", "equal", "truth"]);
});

it.each(["equal", "truth"])("preserves errors from object inequality %s callbacks", phase => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "sentinel");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run(`class Truth:\n def __bool__(self):\n  fail()\nclass Key:\n def __eq__(self,other):\n  ${phase === "equal" ? "fail()" : "return Truth()"}\nleft=Key()\n`);
  expect(() => state.run("object.__ne__(left,left)\n")).toThrow(failure); expect(state.calls.depth).toBe(0);
});

it("exposes object identity hashing through direct, bound and inherited slots", () => {
  const state = fixture();
  state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.run("class Key:\n def __eq__(self,other):\n  return False\n __hash__=object.__hash__\nkey=Key()\nkey.__hash__=None\ndirect=object.__hash__(key)\nbound=Key.__hash__.__get__(key,Key)()\nnormal=hash(key)\nclass_hash=hash(Key)\nnative=object.__hash__([])\nnumber=object.__hash__(7)\nnone=object.__hash__(None)\nresult={key:1}\nfound=key in result\n");
  for (const name of ["direct", "bound", "normal", "class_hash", "native", "number", "none"]) expect(state.globals.get(name)).toEqual(state.v.integer(17));
  expect(state.globals.get("found")).toBe(state.v.true);
});

it.each([
  ["object.__hash__()", "descriptor '__hash__' of 'object' object needs an argument"],
  ["object.__hash__([],1)", "expected 0 arguments, got 1"],
  ["object.__hash__([],x=1)", "wrapper __hash__() takes no keyword arguments"],
  ["object.__hash__([],1,x=1)", "wrapper __hash__() takes no keyword arguments"]
])("validates native identity hash calls: %s", (source, message) => {
  const state = fixture();
  expect(() => state.run(`${source}\n`)).toThrow(message); expect(state.calls.depth).toBe(0);
});

it("unwinds failed key callbacks and rebinds protocols for later module executions", () => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "hash failed");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Key:\n def __hash__(self):\n  fail()\nkey=Key()\ndef make():\n return {key:1}\n");
  expect(() => state.run("result=make()\n")).toThrow(failure); expect(state.calls.depth).toBe(0);
  const key = state.globals.get("key")!;
  expect(() => state.keys.hash(key)).toThrow("guest key hashing requires an active runtime frame");
  expect(() => state.keys.hash(state.v.tuple([key]))).toThrow("guest key hashing requires an active runtime frame");
  state.run("def good(self):\n visit('good')\n return 7\nKey.__hash__=good\nresult=make()\nfound=key in result\n");
  expect(state.globals.get("found")).toBe(state.v.true); expect(state.events).toEqual(["good", "good"]); expect(state.calls.depth).toBe(0);
});

it.each(["dict", "set"])("uses guest hash, reflected equality and truth for %s keys", kind => {
  const state = fixture(), { v, meter } = state;
  state.builtins.set("make", v.builtinFunction({ name: "make", invoke(_args, _keywords, _meter, invocation) {
    const items = new OrderedKeyMap<RuntimeValue, RuntimeValue>(createRuntimeKeyOperations(v, state.hash, meter, invocation), meter);
    return kind === "dict" ? v.dictionary(items) : v.set(items);
  } }));
  state.run(`class Truth:\n def __bool__(self):\n  visit('truth')\n  return True\nclass Key:\n def __hash__(self):\n  visit('hash')\n  return 7\n def __eq__(self,other):\n  visit('base')\n  return False\nclass Child(Key):\n __hash__=Key.__hash__\n def __eq__(self,other):\n  visit('child')\n  return Truth()\nleft=Key()\nright=Child()\nresult=make()\n${kind === "dict" ? "result[left]=1\nresult[right]=2" : "result.add(left)\nresult.add(right)"}\nfound=right in result\n`);
  const result = state.globals.get("result")!;
  if (result.kind !== "dict" && result.kind !== "set") throw Error("expected collection");
  expect(result.items.size).toBe(1); expect(state.globals.get("found")).toBe(v.true);
  expect(state.events).toEqual(["hash", "hash", "child", "truth", "hash", "child", "truth"]);
});

it("calls instance type slots and reflects callability without binding the descriptor", () => {
  const state = fixture(), { v } = state;
  state.run("class C:\n def __call__(self,value,*,extra):\n  return value+extra\ninstance=C()\ninstance.__call__=None\nrecognized=callable(instance)\nresult=instance(7,extra=2)\n");
  expect(state.globals.get("recognized")).toBe(v.true); expect(state.globals.get("result")).toEqual(v.integer(9));
});

it("expands custom keyword mappings through keys and live item lookup", () => {
  const state = fixture(), { v } = state;
  state.run("class Mapping:\n def keys(self):\n  visit('keys')\n  return ['left','right']\n def __getitem__(self,key):\n  visit(key)\n  return 7\ndef target(*,left,right):\n return left+right\nresult=target(**Mapping())\n");
  expect(state.globals.get("result")).toEqual(v.integer(14)); expect(state.events).toEqual(["keys", "left", "right"]);
});

it("unpacks custom mappings into dictionary displays with overwrite semantics", () => {
  const state = fixture();
  state.run("class Mapping:\n def keys(self):\n  visit('keys')\n  return ['left','right']\n def __getitem__(self,key):\n  visit(key)\n  return 7\nresult={'left':1,**Mapping(),'right':9}\nleft=result['left']\nright=result['right']\n");
  expect(state.globals.get("left")).toEqual(state.v.integer(7)); expect(state.globals.get("right")).toEqual(state.v.integer(9)); expect(state.events).toEqual(["keys", "left", "right"]);
});

it("uses one keys lookup and live non-string keys for display unpacking", () => {
  const state = fixture();
  state.run("names=[1,2,1]\ndef keys():\n visit('keys')\n return names\nclass Descriptor:\n def __get__(self,instance,owner):\n  visit('bind')\n  return keys\nclass Mapping:\n keys=Descriptor()\n def __init__(self):\n  self.count=0\n def __getitem__(self,key):\n  visit('get')\n  names[1]=3\n  self.count+=1\n  return self.count\nresult={**Mapping()}\nfirst=result[1]\nsecond=result[3]\n");
  expect(state.events).toEqual(["bind", "keys", "get", "get", "get"]); expect(state.globals.get("first")).toEqual(state.v.integer(3)); expect(state.globals.get("second")).toEqual(state.v.integer(2));
});

it.each(["lookup", "keys", "get"])("preserves display unpacking error boundaries during %s", stage => {
  for (const name of ["AttributeError", "KeyError", "TypeError", "host"]) {
    const state = fixture();
    const failure = name === "KeyError" ? new PythonKeyError(state.v.string("sentinel"), state.meter) : name === "host" ? new Error("host failure") : new PythonRuntimeError(name, "sentinel");
    state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
    const lookup = stage === "lookup" ? "class Descriptor:\n def __get__(self,instance,owner):\n  fail()\n" : "";
    const keys = stage === "lookup" ? " keys=Descriptor()\n" : ` def keys(self):\n  ${stage === "keys" ? "fail()" : "return ['left']"}\n`;
    expect(() => state.run(`${lookup}class Mapping:\n${keys} def __getitem__(self,key):\n  fail()\nresult={**Mapping(),'later':visit('later')}\n`)).toThrow(name === "AttributeError" ? "'Mapping' object is not a mapping" : failure);
    expect(state.events).toEqual([]); expect(state.globals.has("result")).toBe(false);
  }
});

it("does not accept iterable pairs as display mappings", () => {
  const state = fixture();
  expect(() => state.run("class Pairs:\n def __getitem__(self,index):\n  visit('get')\n  return ('left',7)\nresult={**Pairs()}\n")).toThrow("'Pairs' object is not a mapping");
  expect(state.events).toEqual([]);
});

it("updates dictionaries in place from guest mappings and retains identity", () => {
  const state = fixture();
  state.run("class Mapping:\n def keys(self):\n  visit('keys')\n  return ['left','right']\n def __getitem__(self,key):\n  visit(key)\n  return 7\nresult={'left':1}\nalias=result\nresult|=Mapping()\nleft=result['left']\nright=result['right']\n");
  expect(state.globals.get("result")).toBe(state.globals.get("alias")); expect(state.globals.get("left")).toEqual(state.v.integer(7)); expect(state.globals.get("right")).toEqual(state.v.integer(7));
  expect(state.events).toEqual(["keys", "left", "right"]);
});

it("updates dictionaries through native methods using guest mapping protocols", () => {
  const state = fixture();
  state.run("class Mapping:\n def keys(self):\n  visit('keys')\n  return ['left','right']\n def __getitem__(self,key):\n  visit(key)\n  return 7\nresult={}\nreturned=result.update(Mapping(),right=9)\nleft=result['left']\nright=result['right']\n");
  expect(state.globals.get("returned")).toBe(state.v.none); expect(state.globals.get("left")).toEqual(state.v.integer(7)); expect(state.globals.get("right")).toEqual(state.v.integer(9)); expect(state.events).toEqual(["keys", "left", "right"]);
});

it("constructs dictionary keys from guest sequences without consulting length hints", () => {
  const state = fixture();
  state.builtins.set("fromkeys", createDictionaryFromKeysBuiltin(state.v, state.keys, state.meter));
  state.run("class Source:\n def __getitem__(self,index):\n  visit('get')\n  return ('left','right','left')[index]\n def __len__(self):\n  visit('length')\n  return 3\npayload=[]\nresult=fromkeys(Source(),payload)\nleft=result['left']\nright=result['right']\n");
  expect(state.globals.get("left")).toBe(state.globals.get("payload")); expect(state.globals.get("right")).toBe(state.globals.get("payload")); expect(state.events).toEqual(["get", "get", "get", "get"]);
});

it.each([
  ["update", [1, 2, 3]], ["intersection_update", [2]], ["difference_update", [1]], ["symmetric_difference_update", [1, 3]],
  ["union", [1, 2, 3]], ["intersection", [2]], ["difference", [1]], ["symmetric_difference", [1, 3]]
] as const)("runs set %s with guest iterable sources", (method, expected) => {
  const state = fixture();
  state.run(`class Source:\n def __getitem__(self,index):\n  visit('get')\n  return (2,3)[index]\nreceiver={1,2}\nreturned=receiver.${method}(Source())\n`);
  const returned = state.globals.get("returned")!, receiver = state.globals.get("receiver")!;
  const result = returned.kind === "none" ? receiver : returned; if (result.kind !== "set") throw Error("expected set");
  expect(result.items.snapshot().map(([key]) => Number((key as { value: bigint }).value)).sort()).toEqual(expected);
  expect(state.events).toEqual(["get", "get", "get"]);
});

it.each(["isdisjoint", "issubset", "issuperset"])("runs set %s with guest iterable sources", method => {
  const state = fixture();
  state.run(`class Source:\n def __getitem__(self,index):\n  visit('get')\n  return (2,3)[index]\nresult={1,2}.${method}(Source())\n`);
  expect(state.globals.get("result")).toBe(state.v.false);
});

it("expands guest iterables in starred set displays", () => {
  const state = fixture();
  state.run("class Source:\n def __getitem__(self,index):\n  visit('get')\n  return (2,3,2)[index]\n def __len__(self):\n  visit('length')\n  return 3\nresult={1,*Source(),4}\n");
  const result = state.globals.get("result")!; if (result.kind !== "set") throw Error("expected set");
  expect(result.items.size).toBe(4); expect(state.events).toEqual(["get", "get", "get", "get"]);
});

it.each(["keys", "items"])("checks dictionary %s view disjointness against guest iterables", kind => {
  const state = fixture(), entries = kind === "keys" ? "(2,3)" : "((2,20),(3,30))";
  state.run(`class Source:\n def __getitem__(self,index):\n  visit('get')\n  return ${entries}[index]\nresult={1:10,2:20}.${kind}().isdisjoint(Source())\n`);
  expect(state.globals.get("result")).toBe(state.v.false); expect(state.events).toEqual(["get"]);
});

it.each(["keys", "items"])("combines dictionary %s views with forward and reflected guest iterables", kind => {
  for (const [operator, size] of [["|", 3], ["&", 1], ["-", 1], ["^", 2]] as const) for (const reflected of [false, true]) {
    const state = fixture(), entries = kind === "keys" ? "(2,3)" : "((2,20),(3,30))";
    state.run(`class Source:\n def __getitem__(self,index):\n  visit('get')\n  return ${entries}[index]\nview={1:10,2:20}.${kind}()\nresult=${reflected ? `Source()${operator}view` : `view${operator}Source()`}\n`);
    const result = state.globals.get("result")!; if (result.kind !== "set") throw Error("expected set"); expect(result.items.size).toBe(size); expect(state.events).toEqual(["get", "get", "get"]);
  }
});

it.each(["keys", "items"])("observes backing dictionary mutations during %s view iteration", kind => {
  const state = fixture(), key = kind === "keys" ? "3" : "(3,30)";
  state.run(`mapping={1:10}\nview=mapping.${kind}()\nclass Source:\n def __getitem__(self,index):\n  visit('get')\n  mapping[3]=30\n  return (${key},)[index]\ndisjoint=view.isdisjoint(Source())\nresult=view&Source()\n`);
  expect(state.globals.get("disjoint")).toBe(state.v.false);
  const result = state.globals.get("result")!; if (result.kind !== "set") throw Error("expected set"); expect(result.items.size).toBe(1); expect(state.events).toEqual(["get", "get", "get"]);
});

it("retains guest numeric precedence around dictionary view union", () => {
  const state = fixture();
  state.run("class Source:\n def __getitem__(self,index):\n  visit('get')\n  return (2,)[index]\n def __or__(self,other):\n  visit('forward')\n  return 77\n def __ror__(self,other):\n  visit('reflected')\n  return 88\nview={1:10}.keys()\nleft=view|Source()\nright=Source()|view\n");
  expect(state.globals.get("left")?.kind).toBe("set"); expect(state.globals.get("right")).toEqual(state.v.integer(77)); expect(state.events).toEqual(["get", "get", "forward"]);
});

it("uses guest equality and truth for dictionary item view disjointness", () => {
  const state = fixture();
  state.run("class Truth:\n def __bool__(self):\n  visit('truth')\n  return True\nclass Value:\n def __eq__(self,other):\n  visit('equal')\n  return Truth()\nleft=Value()\nright=Value()\nresult={1:left}.items().isdisjoint([(1,right)])\n");
  expect(state.globals.get("result")).toBe(state.v.false); expect(state.events).toEqual(["equal", "truth"]);
});

it("disables inherited hashing when a class defines equality without a hash", () => {
  const state = fixture();
  state.run("class Base:\n def __hash__(self):\n  return 7\nclass Equal(Base):\n def __eq__(self,other):\n  return True\nresult=Equal.__dict__['__hash__']\n");
  expect(state.globals.get("result")).toBe(state.v.none);
});

it("dispatches guest hash methods for direct and nested immutable values", () => {
  const state = fixture(); state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.run("class Value:\n def __hash__(self):\n  visit('hash')\n  return 7\nvalue=Value()\ndirect=hash(value)\nnested=hash((value,value))\nexpected=hash((7,7))\n");
  expect(state.globals.get("direct")).toEqual(state.v.integer(7)); expect(state.globals.get("nested")).toEqual(state.globals.get("expected")); expect(state.events).toEqual(["hash", "hash", "hash"]);
});

it("honors disabled and live hash slots while ignoring instance shadows", () => {
  const state = fixture(); state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.run("class Value:\n def __hash__(self):\n  return 7\nvalue=Value()\nvalue.__hash__=None\nfirst=hash(value)\nValue.__hash__=None\n");
  expect(state.globals.get("first")).toEqual(state.v.integer(7)); expect(() => state.run("hash(value)\n")).toThrow("unhashable type: 'Value'");
  state.run("def replacement(self):\n return -1\nValue.__hash__=replacement\nrestored=hash(value)\nclass Equal:\n __eq__=None\n");
  expect(state.globals.get("restored")).toEqual(state.v.integer(-2)); expect(() => state.run("hash((Equal(),))\n")).toThrow("unhashable type: 'Equal'");
});

it("binds hash descriptors and distinguishes disabled results from invalid return values", () => {
  const state = fixture(); state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.run("def target():\n visit('call')\n return True\nclass Descriptor:\n def __get__(self,instance,owner):\n  visit('bind')\n  return target\nclass Value:\n __hash__=Descriptor()\nresult=hash(Value())\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(1)); expect(state.events).toEqual(["bind", "call"]);
  state.run("def disabled(self,instance,owner):\n return None\nDescriptor.__get__=disabled\n"); expect(() => state.run("hash(Value())\n")).toThrow("unhashable type: 'Value'");
  state.run("def bad(self):\n return 1.5\nValue.__hash__=bad\n"); expect(() => state.run("hash(Value())\n")).toThrow("__hash__ method should return an integer");
});

it("uses metaclass hash slots and normalizes oversized hash results", () => {
  const state = fixture(); state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash));
  state.run("class Meta(type):\n def __hash__(self):\n  visit('meta')\n  return 2**100\nclass Value(metaclass=Meta):\n pass\nresult=hash(Value)\nexpected=hash(2**100)\n");
  expect(state.globals.get("result")).toEqual(state.globals.get("expected")); expect(state.events).toEqual(["meta"]);
});

it("preserves guest hash exceptions and explicit extension precedence", () => {
  const state = fixture(), failure = new PythonRuntimeError("TypeError", "hash failed");
  state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash)); state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Value:\n def __hash__(self):\n  fail()\nvalue=Value()\n");
  expect(() => state.run("hash(value)\n")).toThrow(failure); expect(() => state.run("hash((value,))\n")).toThrow(failure);
  const value = state.globals.get("value")!;
  state.builtins.set("custom", createHashBuiltin(state.v, state.meter, { ...state.hash, guestHash: candidate => candidate !== value ? undefined : { lookupHash: () => () => state.v.integer(19), integer: result => result.kind === "int" ? result.value : undefined, typeName: () => "Value" } }));
  state.run("result=custom(value)\n"); expect(state.globals.get("result")).toEqual(state.v.integer(19));
});

it("treats missing hash descriptors as unhashable without masking hash-body errors", () => {
  const state = fixture(), failure = new PythonRuntimeError("AttributeError", "hash attribute missing");
  state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash)); state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Descriptor:\n def __get__(self,instance,owner):\n  visit('bind')\n  fail()\nclass Value:\n __hash__=Descriptor()\nvalue=Value()\n");
  expect(() => state.run("hash(value)\n")).toThrow("unhashable type: 'Value'"); expect(() => state.run("hash((value,))\n")).toThrow("unhashable type: 'Value'");
  state.run("def body(self):\n fail()\nValue.__hash__=body\n");
  expect(() => state.run("hash(value)\n")).toThrow(failure); expect(state.events).toEqual(["bind", "bind"]);
});

it.each(["TypeError", "ValueError", "host"])("preserves %s failures from hash descriptor binding", name => {
  const state = fixture(), failure = name === "host" ? new Error("host failure") : new PythonRuntimeError(name, "binding failed");
  state.builtins.set("hash", createHashBuiltin(state.v, state.meter, state.hash)); state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Descriptor:\n def __get__(self,instance,owner):\n  fail()\nclass Value:\n __hash__=Descriptor()\nvalue=Value()\n");
  expect(() => state.run("hash(value)\n")).toThrow(failure); expect(() => state.run("hash((value,))\n")).toThrow(failure);
});

it("publishes automatic hash disabling before descriptor initialization and preserves inheritance", () => {
  const state = fixture();
  state.run("class Descriptor:\n def __set_name__(self,owner,name):\n  self.hash=owner.__dict__['__hash__']\nmarker=Descriptor()\nclass Equal:\n __eq__=None\n field=marker\nclass Child(Equal):\n pass\nseen=marker.hash\ninherited=Child.__hash__\nowned=Child.__dict__.get('__hash__','absent')\n");
  expect(state.globals.get("seen")).toBe(state.v.none); expect(state.globals.get("inherited")).toBe(state.v.none); expect(state.globals.get("owned")).toEqual(state.v.string("absent"));
});

it("preserves explicit hash declarations and does not normalize late equality assignments", () => {
  const state = fixture();
  state.run("class Base:\n def __hash__(self):\n  return 7\nclass Explicit(Base):\n __eq__=None\n __hash__=Base.__hash__\nclass Late(Base):\n pass\nLate.__eq__=None\nexplicit=Explicit.__hash__\ninherited=Late.__hash__\noriginal=Base.__hash__\nowned=Late.__dict__.get('__hash__','absent')\nclass OnlyNe:\n __ne__=None\nne_hash=OnlyNe.__dict__.get('__hash__','absent')\n");
  expect(state.globals.get("explicit")).toBe(state.globals.get("original")); expect(state.globals.get("inherited")).toBe(state.globals.get("original"));
  expect(state.globals.get("owned")).toEqual(state.v.string("absent")); expect(state.globals.get("ne_hash")).toEqual(state.v.string("absent"));
});

it("accounts for equality and hash member slots before automatic hash disabling", () => {
  const state = fixture();
  state.run("class EqualSlot:\n __slots__=('__eq__',)\nclass HashSlot:\n __slots__=('__hash__',)\n __eq__=None\ndisabled=EqualSlot.__dict__['__hash__']\nmember=HashSlot.__dict__['__hash__']\n");
  expect(state.globals.get("disabled")).toBe(state.v.none); expect(state.globals.get("member")?.kind).toBe("member_descriptor");
});

it.each(["&", "^"])("uses guest value equality in dictionary items %s", operator => {
  const state = fixture();
  state.run(`class Value:\n def __eq__(self,other):\n  visit('equal')\n  return True\n def __hash__(self):\n  return 1\nleft=Value()\nright=Value()\nresult={1:left}.items()${operator}{1:right}.items()\n`);
  const result = state.globals.get("result")!; if (result.kind !== "set") throw Error("expected set"); expect(result.items.size).toBe(operator === "&" ? 1 : 0); expect(state.events).toEqual(["equal"]);
});

it("retains identity shortcuts for dictionary item view comparisons", () => {
  const state = fixture();
  state.run("class Value:\n def __eq__(self,other):\n  visit('equal')\n  return False\n def __hash__(self):\n  return 1\nvalue=Value()\nleft={1:value}.items()\nright={1:value}.items()\ndisjoint=left.isdisjoint(right)\ncommon=left&right\ndifferent=left^right\n");
  expect(state.globals.get("disjoint")).toBe(state.v.false); expect(state.events).toEqual([]);
  const common = state.globals.get("common")!, different = state.globals.get("different")!;
  if (common.kind !== "set" || different.kind !== "set") throw Error("expected sets"); expect(common.items.size).toBe(1); expect(different.items.size).toBe(0);
});

it.each(["left.isdisjoint(right)", "left&right", "left^right"])("propagates guest truth failures during %s", expression => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "truth failed");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("class Truth:\n def __bool__(self):\n  visit('truth')\n  fail()\nclass Value:\n def __eq__(self,other):\n  visit('equal')\n  return Truth()\nleft={1:Value()}.items()\nright={1:Value()}.items()\nresult=99\n");
  expect(() => state.run(`result=${expression}\n`)).toThrow(failure); expect(state.globals.get("result")).toEqual(state.v.integer(99)); expect(state.events).toEqual(["equal", "truth"]);
});

it.each([["set", constructRuntimeSet], ["frozenset", constructRuntimeFrozenSet]] as const)("constructs %s through active guest iteration", (name, construct) => {
  const state = fixture();
  state.builtins.set(name, state.v.builtinFunction({ name, invoke(args, keywords, meter, context) { return construct(args, keywords, state.v, state.keys, meter, context?.iteration); } }));
  state.run(`class Source:\n def __getitem__(self,index):\n  visit('get')\n  return (2,3,2)[index]\n def __len__(self):\n  visit('length')\n  return None\nresult=${name}(Source())\n`);
  const result = state.globals.get("result")!; if (result.kind !== "set" && result.kind !== "frozenset") throw Error("expected set storage");
  expect(result.kind).toBe(name); expect(result.items.size).toBe(2); expect(state.events).toEqual(["get", "get", "get", "get"]);
  state.events.length = 0;
  expect(() => state.run(`${name}(Source(),None)\n`)).toThrow(`${name} expected at most 1 argument, got 2`);
  expect(() => state.run(`${name}(Source(),extra=1)\n`)).toThrow(`${name}() takes no keyword arguments`); expect(state.events).toEqual([]);
});

it.each(["{1,*Source(),visit('later')}", "set(Source())", "frozenset(Source())"])("does not publish failed set construction through %s", expression => {
  const state = fixture();
  for (const [name, construct] of [["set", constructRuntimeSet], ["frozenset", constructRuntimeFrozenSet]] as const) {
    state.builtins.set(name, state.v.builtinFunction({ name, invoke(args, keywords, meter, context) { return construct(args, keywords, state.v, state.keys, meter, context?.iteration); } }));
  }
  state.run("class Source:\n def __getitem__(self,index):\n  visit('get')\n  return (2,[],3)[index]\nresult=99\n");
  expect(() => state.run(`result=${expression}\n`)).toThrow("unhashable type: 'list'");
  expect(state.globals.get("result")).toEqual(state.v.integer(99)); expect(state.events).toEqual(["get", "get"]);
});

it.each([
  ["update", 3, [1, 2, 3]], ["difference_update", 2, [1]], ["intersection_update", 2, [1, 2]], ["symmetric_difference_update", 3, [1, 2]]
] as const)("preserves set %s failure semantics for guest iteration", (method, first, expected) => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "iteration failed");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  expect(() => state.run(`class Source:\n def __getitem__(self,index):\n  visit('get')\n  if index==1:\n   fail()\n  return ${first}\nreceiver={1,2}\nreceiver.${method}(Source())\n`)).toThrow(failure);
  const receiver = state.globals.get("receiver")!; if (receiver.kind !== "set") throw Error("expected set");
  expect(receiver.items.snapshot().map(([key]) => Number((key as { value: bigint }).value)).sort()).toEqual(expected); expect(state.events).toEqual(["get", "get"]);
});

it.each(["union", "intersection", "difference", "symmetric_difference", "isdisjoint", "issubset", "issuperset"])("retains frozenset receiver semantics for guest %s", method => {
  const state = fixture();
  state.run("class Source:\n def __getitem__(self,index):\n  visit('get')\n  return (2,3)[index]\noriginal={1,2}\n");
  const original = state.globals.get("original")!; if (original.kind !== "set") throw Error("expected set");
  state.globals.set("frozen", state.v.frozenSet(original.items));
  state.run(`result=frozen.${method}(Source())\n`);
  expect(state.globals.get("result")?.kind).toBe(method.startsWith("is") ? "bool" : "frozenset"); expect(original.items.size).toBe(2);
});

it("exposes fromkeys on dictionary instances without copying their entries", () => {
  const state = fixture();
  state.run("original={'old':1}\nfromkeys=original.fromkeys\nresult=fromkeys(('left','right'),7)\nleft=result['left']\nright=result['right']\nold=original['old']\n");
  expect(state.globals.get("left")).toEqual(state.v.integer(7)); expect(state.globals.get("right")).toEqual(state.v.integer(7)); expect(state.globals.get("old")).toEqual(state.v.integer(1));
  expect(state.globals.get("result")).not.toBe(state.globals.get("original"));
});

it("stops fromkeys on an invalid key without closing or exhausting a guest cursor", () => {
  const state = fixture();
  state.builtins.set("finish", state.v.builtinFunction({ name: "finish", invoke() { throw new PythonRuntimeError("StopIteration", ""); } }));
  state.run("class Source:\n def __init__(self):\n  self.index=0\n def __iter__(self):\n  visit('iter')\n  return self\n def __length_hint__(self):\n  visit('hint')\n  return 3\n def __next__(self):\n  visit('next')\n  if self.index==3:\n   finish()\n  key=('left',[],'right')[self.index]\n  self.index+=1\n  return key\n def close(self):\n  visit('close')\nsource=Source()\n");
  expect(() => state.run("{}.fromkeys(source)\n")).toThrow("unhashable type: 'list'");
  state.run("result={}.fromkeys(source,7)\nright=result['right']\n"); expect(state.globals.get("right")).toEqual(state.v.integer(7));
  expect(state.events).toEqual(["iter", "next", "next", "iter", "next", "next"]);
});

it("validates fromkeys arguments before guest iteration and leaves proxies unchanged", () => {
  const state = fixture();
  state.run("class Source:\n def __getitem__(self,index):\n  visit('get')\n  return 'left'\nsource=Source()\noriginal={}\n");
  expect(() => state.run("{}.fromkeys(source,None,None)\n")).toThrow("fromkeys expected at most 2 arguments, got 3");
  expect(() => state.run("{}.fromkeys(source,value=7)\n")).toThrow("dict.fromkeys() takes no keyword arguments");
  expect(state.events).toEqual([]);
  const original = state.globals.get("original")!; if (original.kind !== "dict") throw Error("expected dictionary");
  state.globals.set("proxy", state.v.mappingProxy(original)); expect(() => state.run("proxy.fromkeys\n")).toThrow("'mappingproxy' object has no attribute 'fromkeys'");
});

it("checks update arity before mapping effects but validates keywords after writes", () => {
  const state = fixture();
  state.run("class Mapping:\n def keys(self):\n  visit('keys')\n  return ['left']\n def __getitem__(self,key):\n  visit(key)\n  return 7\nresult={}\n");
  expect(() => state.run("result.update(Mapping(),None)\n")).toThrow("update expected at most 1 argument, got 2"); expect(state.events).toEqual([]);
  expect(() => state.run("result.update(Mapping(),**{1:2})\n")).toThrow("keywords must be strings"); expect(state.events).toEqual(["keys", "left"]);
  state.run("left=result['left']\n"); expect(state.globals.get("left")).toEqual(state.v.integer(7));
});

it("retains partial method updates and does not apply keywords after mapping failure", () => {
  const state = fixture(), failure = new PythonRuntimeError("AttributeError", "mapping failed");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  expect(() => state.run("class Mapping:\n def keys(self):\n  return ['left','right']\n def __getitem__(self,key):\n  visit(key)\n  if key=='right':\n   fail()\n  return 7\nresult={}\nresult.update(Mapping(),left=9)\n")).toThrow(failure);
  state.run("left=result['left']\n"); expect(state.globals.get("left")).toEqual(state.v.integer(7)); expect(state.events).toEqual(["left", "right"]);
});

it("allows extracted update methods to consume guest sequence pairs", () => {
  const state = fixture();
  state.run("class Source:\n def __getitem__(self,index):\n  visit('get')\n  return (('left',7),('right',9))[index]\nresult={}\nupdate=result.update\nreturned=update(Source())\nleft=result['left']\nright=result['right']\n");
  expect(state.globals.get("returned")).toBe(state.v.none); expect(state.globals.get("left")).toEqual(state.v.integer(7)); expect(state.globals.get("right")).toEqual(state.v.integer(9)); expect(state.events).toEqual(["get", "get", "get"]);
});

it("passes guest protocols through dictionary construction before keyword overrides", () => {
  const state = fixture();
  state.builtins.set("make", state.v.builtinFunction({ name: "make", invoke(args, _keywords, meter, context) { return constructRuntimeDictionary(args, new Map([["left", state.v.integer(9)]]), state.v, state.keys, meter, context); } }));
  state.run("class Mapping:\n def keys(self):\n  visit('keys')\n  return ['left','right']\n def __getitem__(self,key):\n  visit(key)\n  return 7\nresult=make(Mapping())\nleft=result['left']\nright=result['right']\n");
  expect(state.globals.get("left")).toEqual(state.v.integer(9)); expect(state.globals.get("right")).toEqual(state.v.integer(7)); expect(state.events).toEqual(["keys", "left", "right"]);
});

it("looks up mapping keys twice and overwrites repeated live keys", () => {
  const state = fixture();
  state.run("def names():\n visit('keys')\n return ['left','left']\nclass Descriptor:\n def __get__(self,instance,owner):\n  visit('bind')\n  return names\nclass Mapping:\n keys=Descriptor()\n def __init__(self):\n  self.count=0\n def __getitem__(self,key):\n  visit(key)\n  self.count+=1\n  return self.count\nresult={}\nresult|=Mapping()\nvalue=result['left']\n");
  expect(state.events).toEqual(["bind", "bind", "keys", "left", "left"]); expect(state.globals.get("value")).toEqual(state.v.integer(2));
});

it("updates dictionaries from guest sequences containing guest pair sequences", () => {
  const state = fixture();
  state.builtins.set("finish", state.v.builtinFunction({ name: "finish", invoke() { throw new PythonRuntimeError("IndexError", ""); } }));
  state.run("class Row:\n def __getitem__(self,index):\n  visit('row')\n  if index==0:\n   return 'left'\n  if index==1:\n   return 7\n  finish()\nclass Source:\n def __getitem__(self,index):\n  visit('source')\n  if index==0:\n   return Row()\n  finish()\nresult={}\nresult|=Source()\nvalue=result['left']\n");
  expect(state.events).toEqual(["source", "row", "row", "row", "source"]); expect(state.globals.get("value")).toEqual(state.v.integer(7));
});

it("preserves prior mapping writes and the original exception on update failure", () => {
  const state = fixture(), failure = new PythonRuntimeError("AttributeError", "lookup failed");
  state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  expect(() => state.run("class Mapping:\n def keys(self):\n  return ['left','right']\n def __getitem__(self,key):\n  visit(key)\n  if key=='right':\n   fail()\n  return 7\nresult={}\nresult|=Mapping()\n")).toThrow(failure);
  state.run("value=result['left']\n"); expect(state.globals.get("value")).toEqual(state.v.integer(7)); expect(state.events).toEqual(["left", "right"]);
});

it("retains live list keys during custom keyword expansion", () => {
  const state = fixture();
  state.run("class Mapping:\n def keys(self):\n  self.names=['left','old']\n  return self.names\n def __getitem__(self,key):\n  visit(key)\n  self.names[1]='right'\n  return 7\ndef target(*,left,right):\n return left+right\nresult=target(**Mapping())\n");
  expect(state.events).toEqual(["left", "right"]); expect(state.globals.get("result")).toEqual(state.v.integer(14));
});

it("materializes custom key iterators before retrieving mapping values", () => {
  const state = fixture();
  state.builtins.set("finish", state.v.builtinFunction({ name: "finish", invoke() { throw new PythonRuntimeError("StopIteration", ""); } }));
  state.run("class Cursor:\n def __init__(self):\n  self.i=0\n def __iter__(self):\n  visit('iter')\n  return self\n def __length_hint__(self):\n  visit('hint')\n  return 2\n def __next__(self):\n  visit('next')\n  self.i+=1\n  if self.i>2:\n   finish()\n  if self.i==1:\n   return 'left'\n  return 'right'\nclass Mapping:\n def keys(self):\n  visit('keys')\n  return Cursor()\n def __getitem__(self,key):\n  visit(key)\n  return 7\ndef target(**kwargs):\n pass\ntarget(**Mapping())\n");
  expect(state.events).toEqual(["keys", "iter", "iter", "hint", "next", "next", "next", "left", "right"]);
});

it("rejects duplicate mapping keys before retrieving their values", () => {
  const state = fixture();
  expect(() => state.run("class Mapping:\n def keys(self):\n  return ['left','left']\n def __getitem__(self,key):\n  visit(key)\n  return 7\ndef target(**kwargs):\n pass\ntarget(**Mapping())\n")).toThrow("guest() got multiple values for keyword argument 'left'");
  expect(state.events).toEqual(["left"]);
});

it.each(["keys", "get"])("translates mapping protocol exceptions from %s", stage => {
  for (const name of ["AttributeError", "KeyError", "TypeError", "ValueError"]) {
    const state = fixture();
    state.builtins.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw name === "KeyError" ? new PythonKeyError(state.v.string("left"), state.meter) : new PythonRuntimeError(name, "sentinel"); } }));
    const source = `class Mapping:\n def keys(self):\n  ${stage === "keys" ? "fail()" : "return ['left']"}\n def __getitem__(self,key):\n  fail()\ndef target(**kwargs):\n pass\ntarget(**Mapping())\n`;
    const expected = name === "AttributeError" ? "guest() argument after ** must be a mapping, not Mapping" : name === "KeyError" ? "guest() got multiple values for keyword argument 'left'" : "sentinel";
    expect(() => state.run(source)).toThrow(expected);
  }
});

it("reports non-iterable mapping keys with owned type names", () => {
  const state = fixture();
  expect(() => state.run("class Mapping:\n def keys(self):\n  return None\ndef target(**kwargs):\n pass\ntarget(**Mapping())\n")).toThrow("Mapping.keys() returned a non-iterable (type NoneType)");
});

it("honors call and descriptor overrides on native method-wrapper subclasses", () => {
  const state = fixture(), { v, registry } = state;
  state.globals.set("staticmethod", registry.methodDecoratorType("staticmethod"));
  state.globals.set("classmethod", registry.methodDecoratorType("classmethod"));
  state.run("def target():\n return 1\nclass Static(staticmethod):\n def __call__(self):\n  return 7\n def __get__(self,instance,owner):\n  return 9\nclass Class(classmethod):\n def __call__(self):\n  return 11\n def __get__(self,instance,owner):\n  return 13\nstatic=Static(target)\nclassed=Class(target)\nstatic_result=static()\nclass_result=classed()\nrecognized=callable(classed)\nclass Owner:\n first=static\n second=classed\nfirst=Owner.first\nsecond=Owner().second\n");
  expect(state.globals.get("static_result")).toEqual(v.integer(7)); expect(state.globals.get("class_result")).toEqual(v.integer(11)); expect(state.globals.get("recognized")).toBe(v.true);
  expect(state.globals.get("first")).toEqual(v.integer(9)); expect(state.globals.get("second")).toEqual(v.integer(13));
});

it("retains inherited wrapper behavior while observing disabled and live overrides", () => {
  const state = fixture(), { v, registry } = state;
  state.globals.set("staticmethod", registry.methodDecoratorType("staticmethod")); state.globals.set("classmethod", registry.methodDecoratorType("classmethod"));
  state.run("def target(*args):\n return 7\nclass Static(staticmethod):\n pass\nclass Class(classmethod):\n pass\nstatic=Static(target)\nclassed=Class(target)\nresult=static()\nclass_callable=callable(classed)\nclass Owner:\n first=static\n second=classed\nfirst=Owner.first()\nsecond=Owner.second()\nStatic.__call__=None\n");
  expect(state.globals.get("result")).toEqual(v.integer(7)); expect(state.globals.get("first")).toEqual(v.integer(7)); expect(state.globals.get("second")).toEqual(v.integer(7)); expect(state.globals.get("class_callable")).toBe(v.false);
  expect(() => state.run("static()\n")).toThrow("'NoneType' object is not callable");
  state.run("Static.__get__=None\n"); expect(() => state.run("Owner.first\n")).toThrow("'NoneType' object is not callable");
  state.run("del Static.__get__\ndel Static.__call__\nrestored=static()\n"); expect(state.globals.get("restored")).toEqual(v.integer(7));
});

it("does not unwrap subclass overrides inside staticmethod and bound-method calls", () => {
  const state = fixture(), { v, registry } = state; state.globals.set("staticmethod", registry.methodDecoratorType("staticmethod"));
  state.run("def target(*args):\n return 1\nclass Static(staticmethod):\n def __call__(self,*args):\n  return 9\nwrapped=Static(target)\nouter=staticmethod(wrapped)\nresult=outer()\nclass Owner:\n pass\n");
  const wrapped = state.globals.get("wrapped")!, owner = state.globals.get("Owner")!;
  state.globals.set("bound", v.boundMethod(wrapped, owner)); state.run("bound_result=bound()\n");
  expect(state.globals.get("result")).toEqual(v.integer(9)); expect(state.globals.get("bound_result")).toEqual(v.integer(9));
});

it("honors data-descriptor slots added by a method-wrapper subclass", () => {
  const state = fixture(), { v, registry } = state; state.globals.set("staticmethod", registry.methodDecoratorType("staticmethod"));
  state.run("def target():\n return 1\nclass Static(staticmethod):\n def __get__(self,instance,owner):\n  return instance.value\n def __set__(self,instance,value):\n  instance.value=value\nclass Owner:\n field=Static(target)\ninstance=Owner()\ninstance.__dict__['field']=99\ninstance.field=7\nresult=instance.field\n");
  expect(state.globals.get("result")).toEqual(v.integer(7));
});

it("distinguishes absent and disabled call slots and observes live class changes", () => {
  const state = fixture(), { v } = state;
  state.run("class C:\n pass\ninstance=C()\nabsent=callable(instance)\ninstance.__call__=None\nshadow=callable(instance)\nC.__call__=None\ndisabled=callable(instance)\n");
  expect(state.globals.get("absent")).toBe(v.false); expect(state.globals.get("shadow")).toBe(v.false); expect(state.globals.get("disabled")).toBe(v.true);
  expect(() => state.run("instance()\n")).toThrow("'NoneType' object is not callable");
  state.run("del C.__call__\n"); expect(() => state.run("instance()\n")).toThrow("'C' object is not callable");
});

it("binds custom call descriptors only during invocation", () => {
  const state = fixture(), { v } = state;
  state.run("def target(value):\n visit('target')\n return value\nclass Descriptor:\n def __get__(self,instance,owner):\n  visit('bind')\n  return target\nclass C:\n __call__=Descriptor()\ninstance=C()\nrecognized=callable(instance)\n");
  expect(state.globals.get("recognized")).toBe(v.true); expect(state.events).toEqual([]);
  state.run("result=instance(7)\n"); expect(state.globals.get("result")).toEqual(v.integer(7)); expect(state.events).toEqual(["bind", "target"]);
  expect(() => state.run("instance(**{1:2})\n")).toThrow("keywords must be strings");
  expect(state.events).toEqual(["bind", "target", "bind"]);
  state.run("C.__call__=None\n");
  expect(() => state.run("instance(**{1:2})\n")).toThrow("'NoneType' object is not callable");
});

it("bounds recursive instance calls and restores the shared call stack", () => {
  const state = fixture(), { v } = state;
  state.run("class C:\n def __call__(self):\n  return self()\ninstance=C()\n");
  expect(() => state.run("instance()\n")).toThrow("maximum recursion depth exceeded");
  expect(state.calls.depth).toBe(0);
  state.run("def replacement(self):\n return 7\nC.__call__=replacement\nresult=instance()\n");
  expect(state.globals.get("result")).toEqual(v.integer(7));
});

it("applies owned data-descriptor precedence for reads, writes and deletion", () => {
  const state = fixture(), { v } = state;
  state.run("class Descriptor:\n def __get__(self,instance,owner):\n  if instance is None:\n   return owner\n  return instance.value\n def __set__(self,instance,value):\n  visit('set')\n  instance.value=value\n def __delete__(self,instance):\n  visit('delete')\n  instance.value=None\nclass C:\n field=Descriptor()\ninstance=C()\ninstance.__dict__['field']=99\ninstance.field=7\nresult=instance.field\nowner=C.field is C\ndel instance.field\nremoved=instance.field\n");
  expect(state.globals.get("result")).toEqual(v.integer(7)); expect(state.globals.get("owner")).toBe(v.true); expect(state.globals.get("removed")).toBe(v.none);
  expect(state.events).toEqual(["set", "delete"]);
});

it("reports missing paired descriptor mutation methods", () => {
  const state = fixture();
  state.run("class SetOnly:\n def __set__(self,instance,value):\n  pass\nclass DeleteOnly:\n def __delete__(self,instance):\n  pass\nclass C:\n setter=SetOnly()\n deleter=DeleteOnly()\ninstance=C()\n");
  expect(() => state.run("del instance.setter\n")).toThrow("__delete__");
  expect(() => state.run("instance.deleter=7\n")).toThrow("__set__");
});

it("bounds descriptor-binding recursion before entering a function body", () => {
  const state = fixture(undefined, 1000000);
  state.run("class Descriptor:\n pass\ndescriptor=Descriptor()\nDescriptor.__get__=descriptor\nclass C:\n __call__=descriptor\ninstance=C()\n");
  expect(() => state.run("instance()\n")).toThrow("maximum recursion depth exceeded"); expect(state.calls.depth).toBe(0);
});

it("constructs ordinary class statements through the concrete builtin builder", () => {
  const state = fixture(), { v } = state;
  state.run("def decorate(cls):\n visit(cls.__name__)\n return cls\n@decorate\nclass C:\n __slots__=('field',)\n def owner(self):\n  return __class__\ninstance=C()\ninstance.field=7\nresult=instance.field\nowner=instance.owner() is C\n");
  expect(state.globals.get("result")).toEqual(v.integer(7)); expect(state.globals.get("owner")).toBe(v.true);
  expect(state.events).toEqual(["C"]); expect(state.globals.has("__slots__")).toBe(false);
});

it("dispatches ordinary subscription reads, writes, augmentation and deletion to guest slots", () => {
  const state = fixture(), { v } = state;
  state.run("class Mapping:\n def __getitem__(self,key):\n  visit('get:'+key)\n  return self.value\n def __setitem__(self,key,value):\n  visit('set:'+key)\n  self.value=value\n def __delitem__(self,key):\n  visit('del:'+key)\n  self.value=None\nmapping=Mapping()\nmapping['field']=7\nmapping['field']+=2\nresult=mapping['field']\ndel mapping['field']\nremoved=mapping.value\n");
  expect(state.globals.get("result")).toEqual(v.integer(9)); expect(state.globals.get("removed")).toBe(v.none);
  expect(state.events).toEqual(["set:field", "get:field", "set:field", "get:field", "del:field"]);
});

it("binds inherited class subscription and prioritizes the metaclass item slot", () => {
  const state = fixture(), { v } = state;
  state.run("class Base:\n def __class_getitem__(cls,key):\n  visit(key)\n  return cls\nclass Child(Base):\n pass\nselected=Child['class'] is Child\nclass Meta(type):\n def __getitem__(cls,key):\n  visit(key)\n  return 7\nclass C(Base,metaclass=Meta):\n pass\nresult=C['meta']\n");
  expect(state.globals.get("selected")).toBe(v.true); expect(state.globals.get("result")).toEqual(v.integer(7));
  expect(state.events).toEqual(["class", "meta"]);
});

it("passes tuple and slice keys unchanged and ignores instance method shadows", () => {
  const state = fixture(), { v } = state;
  state.run("class C:\n def __getitem__(self,key):\n  return key\ninstance=C()\ninstance.__getitem__=None\ntuple_key=instance[1,2]\nslice_key=instance[1:5:2]\n");
  expect(state.globals.get("tuple_key")).toEqual(v.tuple([v.integer(1), v.integer(2)]));
  expect(state.globals.get("slice_key")).toMatchObject({ kind: "slice", start: v.integer(1), stop: v.integer(5), step: v.integer(2) });
});

it("does not fall back past disabled metaclass subscription or class subscription", () => {
  const state = fixture();
  state.run("class C:\n __class_getitem__=None\nclass Meta(type):\n __getitem__=None\nclass D(metaclass=Meta):\n def __class_getitem__(cls,key):\n  visit('must not call')\n");
  expect(() => state.run("C[1]\n")).toThrow("type 'C' is not subscriptable");
  expect(() => state.run("D[1]\n")).toThrow("'NoneType' object is not callable"); expect(state.events).toEqual([]);
});

it("reports missing paired mutation slots separately from unsupported subscriptions", () => {
  const state = fixture();
  state.run("class Plain:\n pass\nclass SetOnly:\n def __setitem__(self,key,value):\n  pass\nclass DeleteOnly:\n def __delitem__(self,key):\n  pass\nplain=Plain()\nsetter=SetOnly()\ndeleter=DeleteOnly()\n");
  expect(() => state.run("plain[1]\n")).toThrow("'Plain' object is not subscriptable");
  expect(() => state.run("plain[1]=2\n")).toThrow("'Plain' object does not support item assignment");
  expect(() => state.run("del plain[1]\n")).toThrow("'Plain' object doesn't support item deletion");
  expect(() => state.run("del setter[1]\n")).toThrow("__delitem__");
  expect(() => state.run("deleter[1]=2\n")).toThrow("__setitem__");
});

it("re-resolves the setter after an augmented read changes the class", () => {
  const state = fixture(), { v } = state;
  state.run("def replacement(self,key,value):\n visit('new setter')\n self.value=value\nclass C:\n def __getitem__(self,key):\n  C.__setitem__=replacement\n  return 7\n def __setitem__(self,key,value):\n  visit('old setter')\ninstance=C()\ninstance[1]+=2\nresult=instance.value\n");
  expect(state.events).toEqual(["new setter"]); expect(state.globals.get("result")).toEqual(v.integer(9));
});

it("executes prepared class bodies without leaking locals and keeps class closure cells", () => {
  const state = fixture(), { v, registry } = state;
  state.builtins.set("__build_class__", v.builtinFunction({ name: "__build_class__", invoke(args, keywords, meter, invocation) {
    const namespace = v.dictionary(registry.object.value.namespace.items.emptyCopy());
    if (args[0].kind !== "function") throw Error("expected body");
    const cell = invocation!.executeClassBody!(args[0], namespace);
    const result = invocation!.call(registry.type, [args[1], v.tuple(args.slice(2)), namespace], keywords);
    if (cell !== undefined) expect(cell.content?.value).toBe(result);
    return result;
  } }));
  state.run("def outer(value):\n class C:\n  field=value\n  def owner(self):\n   return __class__\n return C\nC=outer(7)\nresult=C.field\nowner=C().owner() is C\n");
  expect(state.globals.get("result")).toEqual(v.integer(7)); expect(state.globals.get("owner")).toBe(v.true);
  expect(state.globals.has("field")).toBe(false); expect(state.globals.has("__qualname__")).toBe(false);
});

it("orders native builder preparation, body, allocation, initialization and decoration", () => {
  const state = fixture(), { v, registry } = state;
  state.globals.set("classmethod", registry.methodDecoratorType("classmethod"));
  state.run("class Meta(type):\n @classmethod\n def __prepare__(meta,name,bases,*,flag):\n  visit('prepare:'+flag)\n  return {'seed':7}\n def __new__(meta,name,bases,namespace,*,flag):\n  visit('new:'+flag)\n  return type.__new__(meta,name,bases,namespace)\n def __init__(cls,name,bases,namespace,*,flag):\n  visit('init:'+flag)\ndef decorate(cls):\n visit('decorate')\n return cls\n@decorate\nclass C(metaclass=Meta,flag='value'):\n visit('body')\n field=seed\nresult=C.field\n");
  expect(state.events).toEqual(["prepare:value", "body", "new:value", "init:value", "decorate"]);
  expect(state.globals.get("result")).toEqual(v.integer(7));
});

it("resolves MRO entries before preparation and records the original base tuple", () => {
  const state = fixture(), { v } = state;
  state.run("class Base:\n pass\nclass Proxy:\n def __mro_entries__(self,bases):\n  visit('resolve')\n  return (Base,)\nproxy=Proxy()\nclass C(proxy):\n __orig_bases__=None\noriginal=C.__orig_bases__[0] is proxy\nresolved=C.__bases__[0] is Base\n");
  expect(state.events).toEqual(["resolve"]); expect(state.globals.get("original")).toBe(v.true); expect(state.globals.get("resolved")).toBe(v.true);
});

it("allows non-type metaclasses and arbitrary results without class-cell checks", () => {
  const state = fixture();
  state.run("def meta(name,bases,namespace,*,flag):\n visit(flag)\n return False\nclass C(metaclass=meta,flag='construct'):\n def owner(self):\n  return __class__\n");
  expect(state.events).toEqual(["construct"]); expect(state.globals.get("C")).toBe(state.v.false);
});

it("checks preparation mapping flags before executing the body", () => {
  const state = fixture(); state.globals.set("classmethod", state.registry.methodDecoratorType("classmethod"));
  state.run("class Meta(type):\n @classmethod\n def __prepare__(meta,*args):\n  return None\n");
  expect(() => state.run("class C(metaclass=Meta):\n visit('body')\n")).toThrow("Meta.__prepare__() must return a mapping, not NoneType");
  state.run("class SequenceMeta(type):\n @classmethod\n def __prepare__(meta,*args):\n  return []\n");
  expect(() => state.run("class C(metaclass=SequenceMeta):\n visit('body')\n")).toThrow("list indices must be integers or slices, not str");
  expect(state.events).toEqual([]); expect(state.globals.has("C")).toBe(false);
});

it("diagnoses a metaclass that drops the captured class cell", () => {
  const state = fixture();
  state.run("class Meta(type):\n def __new__(meta,name,bases,namespace):\n  namespace.pop('__classcell__')\n  return type.__new__(meta,name,bases,namespace)\n");
  expect(() => state.run("class C(metaclass=Meta):\n def owner(self):\n  return __class__\n")).toThrow("__class__ not set defining 'C' as <class 'example.C'>. Was __classcell__ propagated to type.__new__?");
  expect(state.globals.has("C")).toBe(false);
});

it("rejects a metaclass result inconsistent with the captured class cell", () => {
  const state = fixture();
  state.run("class Other:\n pass\nclass Meta(type):\n def __new__(meta,name,bases,namespace):\n  created=type.__new__(meta,name,bases,namespace)\n  return Other\n");
  expect(() => state.run("class C(metaclass=Meta):\n def owner(self):\n  return __class__\n")).toThrow("__class__ set to <class 'example.C'> defining 'C' as <class 'example.Other'>");
  expect(state.globals.has("C")).toBe(false);
});

it("prepares independent namespaces through inherited native class-method binding", () => {
  const state = fixture();
  state.run("Meta=type('Meta',(type,),{})\nfirst=type.__prepare__()\nsecond=Meta.__prepare__(None,False,1,unexpected=True)\nfirst['field']=7\nC=type.__new__(Meta,'C',(),first)\nresult=C.field\nindependent=first is not second\nowner=Meta.__prepare__.__self__ is Meta\ndoc=Meta.__prepare__.__doc__\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(7));
  expect(state.globals.get("independent")).toBe(state.v.true); expect(state.globals.get("owner")).toBe(state.v.true);
  expect(state.globals.get("second")).toMatchObject({ kind: "dict", items: { size: 0 } });
  expect(state.globals.get("doc")).toEqual(state.v.string("Create the namespace for the class statement"));
});

it("executes custom prepared mapping slots in order and replaces deletion failures", () => {
  const state = fixture(), { v } = state, events: string[] = [];
  const keyName = (key: RuntimeValue) => { if (key.kind !== "str") throw Error("expected name"); return String.fromCodePoint(...key.value); };
  state.globals.set("read", v.builtinFunction({ name: "read", invoke(args) {
    const key = keyName(args[0]); events.push("get:" + key);
    if (key === "supplied") return v.integer(17);
    throw new PythonRuntimeError("KeyError", key);
  } }));
  state.globals.set("write", v.builtinFunction({ name: "write", invoke(args) { events.push("set:" + keyName(args[0])); return v.none; } }));
  state.globals.set("remove", v.builtinFunction({ name: "remove", invoke(args) { events.push("del:" + keyName(args[0])); throw new PythonRuntimeError("ValueError", "denied"); } }));
  state.run("def get(self,key):\n return read(key)\ndef set(self,key,value):\n return write(key,value)\ndef delete(self,key):\n return remove(key)\nMapping=type('Mapping',(),{'__getitem__':get,'__setitem__':set,'__delitem__':delete})\nnamespace=Mapping()\n");
  state.builtins.set("__build_class__", v.builtinFunction({ name: "__build_class__", invoke(args, _keywords, _meter, invocation) {
    if (args[0].kind !== "function") throw Error("expected body");
    invocation!.executeClassBody!(args[0], state.globals.get("namespace")!); return v.none;
  } }));
  expect(() => state.run("class C:\n field=supplied\n del field\n")).toThrow("name 'field' is not defined");
  expect(events).toEqual(["get:__name__", "set:__module__", "set:__qualname__", "set:__firstlineno__", "get:supplied", "set:field", "del:field"]);
  expect(state.globals.has("C")).toBe(false);
});

it("keeps optimized function bodies independent of a supplied class namespace", () => {
  const state = fixture(), { v } = state, cell = v.cell({}); state.globals.set("cell", cell);
  state.globals.set("execute", v.builtinFunction({ name: "execute", invoke(args, _keywords, _meter, invocation) {
    if (args[0].kind !== "function") throw Error("expected body");
    const result = invocation!.executeClassBody!(args[0], v.none); return result === cell.value ? v.true : v.false;
  } }));
  state.run("def body():\n local=7\n return cell\nresult=execute(body)\n");
  expect(state.globals.get("result")).toBe(v.true); expect(state.globals.has("local")).toBe(false);
  state.run("def requires(value):\n return value\n");
  expect(() => state.run("execute(requires)\n")).toThrow("missing 1 required positional argument");
});

it("constructs slotted classes through explicit type.__new__ and ordinary type calls", () => {
  const state = fixture();
  state.run("C=type.__new__(type,'C',(),{'__slots__':('x',)})\nD=type('D',(C,),{})\ninstance=D()\ninstance.x=7\nresult=instance.x\nmodule=C.__module__\n");
  expect(state.globals.get("result")).toEqual(state.v.integer(7)); expect(state.globals.get("module")).toEqual(state.v.string("example"));
});

it("delegates only to a more-derived metaclass allocator and leaves initialization to type calls", () => {
  const state = fixture();
  state.run("def make(meta,name,bases,namespace):\n visit('new:'+name)\n return type.__new__(meta,name,bases,namespace)\ndef initialize(cls,name,bases,namespace):\n visit('init:'+name)\nMeta=type('Meta',(type,),{'__new__':make,'__init__':initialize})\nBase=type.__new__(Meta,'Base',(),{})\nC=type.__new__(type,'C',(Base,),{})\nD=type.__new__(Meta,'D',(),{})\nE=type('E',(Base,),{})\nselected=type(C) is Meta\n");
  expect(state.events).toEqual(["new:C", "new:E", "init:E"]); expect(state.globals.get("selected")).toBe(state.v.true);
});

it("uses ordinary metaclass attribute lookup when delegating a winning allocator", () => {
  const state = fixture();
  state.run("def read(cls,name):\n if name=='__new__': visit('read-new')\n return type.__getattribute__(cls,name)\ndef make(meta,name,bases,namespace):\n visit('new')\n return type.__new__(meta,name,bases,namespace)\nMM=type('MM',(type,),{'__getattribute__':read})\nMeta=type.__new__(MM,'Meta',(type,),{'__new__':make})\nBase=type.__new__(Meta,'Base',(),{})\nC=type.__new__(type,'C',(Base,),{})\n");
  expect(state.events).toEqual(["read-new", "new"]);
});

it("does not finalize or initialize an unrelated result from delegated allocation", () => {
  const state = fixture();
  state.run("def make(meta,name,bases,namespace):\n visit('new')\n return False\ndef initialize(cls,*args):\n visit('init')\nMeta=type('Meta',(type,),{'__new__':make,'__init__':initialize})\nBase=type.__new__(Meta,'Base',(),{})\nfirst=type.__new__(type,'C',(Base,),{})\nsecond=type('D',(Base,),{})\n");
  expect(state.events).toEqual(["new", "new"]); expect(state.globals.get("first")).toBe(state.v.false); expect(state.globals.get("second")).toBe(state.v.false);
});

it("detects metaclass conflicts before publishing a class cell", () => {
  const state = fixture(), cell = state.v.cell({}); state.globals.set("cell", cell);
  state.run("M1=type('M1',(type,),{})\nM2=type('M2',(type,),{})\nA=type.__new__(M1,'A',(),{})\nB=type.__new__(M2,'B',(),{})\n");
  expect(() => state.run("type.__new__(type,'C',(A,B),{'__classcell__':cell})\n")).toThrow("metaclass conflict");
  expect(cell.value.content).toBeUndefined();
});

it("runs set-name callbacks before the inherited subclass hook with class keywords", () => {
  const state = fixture();
  state.run("def set_name(self,owner,name):\n visit(name)\n owner.seen=name\ndef initialize(cls,*,flag):\n visit(flag)\nBase=type('Base',(),{'__init_subclass__':initialize})\nDescriptor=type('Descriptor',(),{'__set_name__':set_name})\ndescriptor=Descriptor()\nC=type.__new__(type,'C',(Base,),{'field':descriptor},flag='subclass')\nseen=C.seen\n");
  expect(state.events).toEqual(["field", "subclass"]); expect(state.globals.get("seen")).toEqual(state.v.string("field"));
});

it("rejects unresolved non-type bases without invoking their mro-entries hook", () => {
  const state = fixture(); state.run("Base=type('Base',(),{'__mro_entries__':None})\nbase=Base()\n");
  expect(() => state.run("type.__new__(type,'C',(base,),{})\n")).toThrow("type() doesn't support MRO entry resolution; use types.new_class()");
  expect(() => state.run("type.__new__(type,'C',(1,),{})\n")).toThrow("metaclass conflict");
});

it("keeps the published class cell and annotates set-name failures", () => {
  const state = fixture(), failure = new PythonRuntimeError("ValueError", "set-name failed"), cell = state.v.cell({});
  state.globals.set("cell", cell); state.globals.set("fail", state.v.builtinFunction({ name: "fail", invoke() { throw failure; } }));
  state.run("def set_name(self,owner,name):\n fail()\nDescriptor=type('Descriptor',(),{'__set_name__':set_name})\ndescriptor=Descriptor()\n");
  expect(() => state.run("C=type('C',(),{'field':descriptor,'__classcell__':cell})\n")).toThrow(failure);
  expect(cell.value.content?.value.kind).toBe("type"); expect(state.globals.has("C")).toBe(false);
  expect(failure.notes).toEqual(["Error calling __set_name__ on 'Descriptor' instance 'field' in 'C'"]);
});
