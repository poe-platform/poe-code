import {expect,it,vi} from "vitest";
import {createCompileBuiltin,type CompileRequest} from "./builtin-compile.js";
import {RuntimeValues,type RuntimeValue,type BuiltinInvocationContext} from "./runtime-values.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {constructRuntimeDictionary} from "./runtime-dictionary-update.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:10000000}),v=new RuntimeValues(meter);
  const keywords=constructRuntimeDictionary([],new Map(),v,{hash:()=>1n,equal:(a,b)=>a===b},meter);
  const requests:CompileRequest[]=[],events:string[]=[];
  const inheritedFlags=vi.fn(()=>{events.push("inherit");return 0x1000000;});
  const builtin=createCompileBuiltin(v,meter,{filename(value){events.push("filename");if(value.kind!=="str")throw Error("path policy");return Array.from(value.value,p=>String.fromCodePoint(p)).join("");},inheritedFlags,compile(request){events.push("compile");requests.push(request);return v.notImplemented;}});
  const args=()=>[v.string("1"),v.string("guest.py"),v.string("eval")];
  const call=(positional=args(),invocation?:BuiltinInvocationContext)=>builtin.value.invoke(positional,keywords,meter,invocation);
  return {meter,v,keywords,requests,events,inheritedFlags,builtin,args,call};
}
it("binds defaults, inherits caller futures and preserves source identity",()=>{
  const state=fixture(),args=state.args();expect(state.call(args)).toBe(state.v.notImplemented);
  expect(state.requests).toEqual([{source:args[0],filename:"guest.py",mode:"eval",flags:0x1000000,optimize:-1,featureVersion:-1}]);
  expect(state.events).toEqual(["filename","inherit","compile"]);
});
it("supports keyword binding and truth-based dont_inherit",()=>{
  const state=fixture(),{v,keywords}=state;
  for(const [name,value]of [["source",v.string("x")],["filename",v.string("x.py")],["mode",v.string("single")],["flags",v.integer(0x20000)],["dont_inherit",v.float(1.5)],["optimize",v.integer(2)],["_feature_version",v.integer(12)]] as const)keywords.items.set(v.string(name),value);
  state.call([]);expect(state.requests[0]).toMatchObject({mode:"single",flags:0x20000,optimize:2,featureVersion:12});expect(state.inheritedFlags).not.toHaveBeenCalled();
});
it.each([[0,"source"],[1,"filename"],[2,"mode"]] as const)("reports the first missing required argument: %s",(count,name)=>{
  const state=fixture();expect(()=>state.call(state.args().slice(0,count))).toThrow(`compile() missing required argument '${name}' (pos ${count+1})`);
});
it("reports duplicate and unexpected keywords without invoking policies",()=>{
  const state=fixture();state.keywords.items.set(state.v.string("source"),state.v.none);
  expect(()=>state.call()).toThrow("argument for compile() given by name ('source') and position (1)");
  state.keywords.items.clear();state.keywords.items.set(state.v.string("other"),state.v.none);
  expect(()=>state.call()).toThrow("compile() got an unexpected keyword argument 'other'");expect(state.events).toEqual([]);
});
it.each([1,2])("reports missing arguments before duplicate keywords: %s",count=>{
  const state=fixture();state.keywords.items.set(state.v.string("source"),state.v.none);
  expect(()=>state.call(state.args().slice(0,count))).toThrow(count===1?"compile() missing required argument 'filename' (pos 2)":"compile() missing required argument 'mode' (pos 3)");
});
it("suggests misspelled keyword names and uses clinic None diagnostics",()=>{
  const state=fixture();state.keywords.items.set(state.v.string("sourc"),state.v.none);
  expect(()=>state.call()).toThrow("compile() got an unexpected keyword argument 'sourc'. Did you mean 'source'?");
  state.keywords.items.clear();expect(()=>state.call([state.v.string("1"),state.v.string("x"),state.v.none])).toThrow("compile() argument 'mode' must be str, not None");
});
it("rejects excessive positional and total keyword arguments",()=>{
  const state=fixture();expect(()=>state.call(Array(7).fill(state.v.none))).toThrow("compile() takes at most 6 positional arguments (7 given)");
  for(let i=0;i<8;i++)state.keywords.items.set(state.v.string("key"+i),state.v.none);
  expect(()=>state.call([])).toThrow("compile() takes at most 7 keyword arguments (8 given)");
});
it.each([3,5,6])("checks C-int overflow for integer parameters: %s",position=>{
  const state=fixture(),args=[...state.args(),state.v.integer(0),state.v.false,state.v.integer(-1)];
  if(position===6)state.keywords.items.set(state.v.string("_feature_version"),state.v.integer(1n<<40n));else args[position]=state.v.integer(1n<<40n);
  expect(()=>state.call(args)).toThrow("Python int too large to convert to C int");expect(state.requests).toEqual([]);
});
it("preserves conversion order before validating flag and optimize values",()=>{
  const state=fixture(),{v}=state,events=state.events;
  const index={integer:(value:RuntimeValue)=>value.kind==="int"?value.value:undefined,isExactInteger:(value:RuntimeValue)=>value.kind==="int",typeName:()=>"Index",warn(){},lookupIndex(){events.push("index");return ()=>v.integer(0);}};
  state.keywords.items.set(v.string("_feature_version"),v.cell({}));
  state.call([...state.args(),v.cell({}),v.cell({}),v.cell({})],{integerIndex:index,truth(){events.push("truth");return false;}} as BuiltinInvocationContext);
  expect(events).toEqual(["filename","index","truth","index","index","inherit","compile"]);
});
it.each([["flags",1,"compile(): unrecognised flags"],["optimize",3,"compile(): invalid optimize value"],["mode","bad","compile() mode must be 'exec', 'eval' or 'single'"]] as const)("validates %s before invoking the backend",(name,value,message)=>{
  const state=fixture(),args=state.args();if(name==="mode")args.pop();
  state.keywords.items.set(state.v.string(name),typeof value==="number"?state.v.integer(value):state.v.string(value));
  expect(()=>state.call(args)).toThrow(message);expect(state.requests).toEqual([]);
});
it("observes cancellation from a throwing filename policy",()=>{
  const state=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const builtin=createCompileBuiltin(state.v,meter,{filename(){controller.abort();throw Error("path failure");},compile(){return state.v.none;}});
  expect(()=>builtin.value.invoke(state.args(),state.keywords,meter)).toThrow(ExecutionLimitError);
});
it("forwards func_type only when AST compilation is requested",()=>{
  const state=fixture(),args=[state.v.string("(int) -> str"),state.v.string("x"),state.v.string("func_type")];
  expect(()=>state.call(args)).toThrow("compile() mode 'func_type' requires flag PyCF_ONLY_AST");
  state.call([...args,state.v.integer(0x400)]);
  expect(state.requests[0]).toMatchObject({mode:"func_type",flags:0x1000400});
});
it("includes func_type in mode diagnostics when AST output is enabled",()=>{
  const state=fixture();expect(()=>state.call([state.v.string("1"),state.v.string("x"),state.v.string("bad"),state.v.integer(0x400)])).toThrow("compile() mode must be 'exec', 'eval', 'single' or 'func_type'");
});
