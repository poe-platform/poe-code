import { runInNewContext } from "node:vm";
import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { serialize, type RuntimeSnapshotValue } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { Budget } from "./budget.js";
import { iteratorWrapperStates } from "./iterator-wrapper.js";
import { isSandboxClosure, measureSandboxData } from "./values.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { validateGuestHeapNode } from "../snapshot/guest-heap-validation.js";

const cases = [
  "return typeof Iterator",
  "return Iterator.prototype === Object.getPrototypeOf(Object.getPrototypeOf([].values()))",
  "return [Iterator.name, Iterator.length, Iterator.from.name, Iterator.from.length]",
  "try { Iterator(); } catch (error) { return error.name; }",
  "try { new Iterator(); } catch (error) { return error.name; }",
  "class Counter extends Iterator { next() { return {value:1,done:false}; } } const it=new Counter(); return [it instanceof Counter,it instanceof Iterator,it[Symbol.iterator]()===it,it.next()]",
  "const it=[1,2].values(); return Iterator.from(it)===it",
  "const it=Iterator.from('a😀b'); return [it.next(),it.next(),it.next(),it.next()]",
  "const it=Iterator.from({next(){return {value:7,done:false}}}); return [it instanceof Iterator,it[Symbol.iterator]()===it,it.next(),it.return()]",
  "const log=[]; const source={get next(){log.push('get');return function(){log.push(this===source);return 7}}}; const it=Iterator.from(source); Object.defineProperty(source,'next',{value:()=>9});return [it.next(),log]",
  "const source={next(){return {done:false}},return(){return {value:this===source,done:true}}}; return Iterator.from(source).return()",
  "try { Iterator.from(7); } catch(error) { return error.name; }",
  "const it=Iterator.from({next(){return arguments.length},return(){return arguments.length}});return [it.next(7),it.return(8)]",
  "const it=Iterator.from({next:7});try{it.next()}catch(error){return error.name}",
  "const source={next(){return 1},return:7};const it=Iterator.from(source);try{it.return()}catch(error){return error.name}",
  "const source={next(){return 1},return(){return 2}};const it=Iterator.from(source);return [it.next(),it.return(),it.next()]",
  "const a=Iterator.from({next(){return {done:true}}});const b=Iterator.from({next(){return {done:true}}});return [Object.getPrototypeOf(a)===Object.getPrototypeOf(b),Reflect.ownKeys(a),a.next===b.next,a.return===b.return]",
  "const next=Iterator.from({next(){return 1}}).next;try{next.call({})}catch(error){return error.name}",
  "let reads=0;const it=Object.create(Iterator.prototype);Object.defineProperty(it,'next',{get(){reads++;return ()=>({done:true})}});return [Iterator.from(it)===it,reads]"
];

it.each(cases)("implements the standard Iterator constructor and from: %s", async source => {
  const expected=runInNewContext("(()=>{"+source+"})()");
  const result=await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual(expected);
});

it("retains the wrapped iterator and cached next in its data budget",()=>{
  const wrapper={};
  iteratorWrapperStates.set(wrapper,{iterator:{text:'x'.repeat(100)},next:'y'.repeat(100)});
  expect(measureSandboxData([wrapper])).toBeGreaterThanOrEqual(200);
});

it.each([
  "Iterator.from({next(){return {done:true}}})",
  "{nested:Iterator.from({next(){return {done:true}}})}",
  "new Map([[1,Iterator.from({next(){return {done:true}}})]])"
])("rejects structured cloning of wrapped iterators: %s",async expression=>{
  const result=await run("try{structuredClone("+expression+");return 'cloned'}catch(error){return error.name}");
  assert(result.ok);
  expect(result.returnValue).toBe("DataCloneError");
});

it("restores private wrapper state and cyclic custom properties",async()=>{
  const source="const source={index:0,next(){return {value:this.index++,done:false}}};const it=Iterator.from(source);it.self=it;it.next();return it";
  const result=await run(source);
  assert(result.ok);
  assert(result.returnValue !== null && typeof result.returnValue === 'object');
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:'external',bindings:{it:result.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget=new Budget();
  const binding=restore(JSON.parse(JSON.stringify(snapshot)),{source,budget}).currentScope.lookup('it');
  assert(binding.found);
  assert(binding.value !== null && typeof binding.value === 'object');
  expect(iteratorWrapperStates.has(binding.value)).toBe(true);
  expect(Object.getOwnPropertyDescriptor(binding.value,'self')?.value).toBe(binding.value);
  const state=iteratorWrapperStates.get(binding.value)!;
  assert(isSandboxClosure(state.next));
  expect(await invokeBuiltinClosure(state.next,[],budget,undefined,state.iterator)).toEqual({value:1,done:false});
});

it.each([undefined,null,7,{kind:'ref',id:99}])("rejects malformed wrapped iterator state: %j",iterator=>{
  expect(()=>validateGuestHeapNode({kind:'iterator-wrapper',iterator,next:{kind:'undefined'},state:{properties:{properties:[],extensible:true}}},{},100)).toThrow(TypeError);
});

it("replays a consumed wrapper and its cached next after await",async()=>{
  const source="const source={index:0,next(){return {value:this.index++,done:false}}};const it=Iterator.from(source);const first=it.next();source.next=()=>({value:99,done:true});Object.defineProperty(it,'self',{get(){return it}});await 0;return [first,it.next(),it.self===it,it instanceof Iterator]";
  const expected=await runInNewContext("(async()=>{"+source+"})()");
  const first=await run(source);
  assert(first.ok);
  expect(first.returnValue).toEqual(expected);
  const replay=await run(source,{snapshot:JSON.parse(await dump(first))});
  assert(replay.ok);
  expect(replay.returnValue).toEqual(expected);
});
