import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { declareHostOperation } from "./host-bridge.js";
import { Budget, SandboxError } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { generatorPrototypes } from "./generator-prototypes.js";
import { getGuestFunctionProperty, getSandboxDataProperty, getSandboxPrototype, materializeFunctionProperties, releaseObjectPrototype } from "./object-model.js";
import { isSandboxClosure, isSandboxGenerator, isSandboxPromise, measureSandboxData, reconcileCompiledValues } from "./values.js";
import { serialize, type RuntimeSnapshotValue } from "../snapshot/serialize.js";
import { restore as restoreGraph } from "../snapshot/restore.js";
import { runResources, withRunResources } from "./resources.js";
import { interpret } from "./interpreter.js";
import { parseModule } from "../parse/parser.js";
import { createObjectArrayGlobals } from "./globals/object-array.js";
import { getGeneratorProperties } from "./generator-properties.js";

it.each([
  "const value=(function*(){yield 1})();return [typeof value[Symbol.iterator],value.next===value.next]",
  "const first=(function*(){yield 1})();const second=(function*(){yield 2})();return first.next.call(second)",
  "const value=(function*(){yield 1})();try{value.next.call({})}catch(error){return error.name}",
  "function* values(){yield 1}return [typeof values.prototype,Object.getPrototypeOf(values())===values.prototype]",
  "function* values(){yield 1}values.prototype={extra:3};return values().extra",
  "function* first(){yield 1}function* second(){yield 2}return [Object.getPrototypeOf(first())===Object.getPrototypeOf(first()),Object.getPrototypeOf(first())!==Object.getPrototypeOf(second())]",
  "const value=(async function*(){yield 1})();return [typeof value[Symbol.asyncIterator],Object.prototype.toString.call(value)]"
])("implements generator intrinsic prototypes: %s", async source => {
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it.each([
  "function* f(){} const p=Object.getPrototypeOf(f);const g=Object.getPrototypeOf(f.prototype);return [typeof p,Object.getPrototypeOf(p)===Object.getPrototypeOf(function(){}),p.prototype===g,g.constructor===p,Object.hasOwn(f.prototype,'constructor'),Object.getPrototypeOf(g)===Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())),Object.prototype.toString.call(f)]",
  "async function* f(){} const p=Object.getPrototypeOf(f);const g=Object.getPrototypeOf(f.prototype);return [typeof p,Object.getPrototypeOf(p)===Object.getPrototypeOf(function(){}),p.prototype===g,g.constructor===p,Object.hasOwn(f.prototype,'constructor'),Object.prototype.toString.call(f)]",
  "function* f(x=(f.prototype={changed:true})){}const old=f.prototype;const value=f();return [Object.getPrototypeOf(value)===old,Object.getPrototypeOf(value)===f.prototype]",
  "async function* f(x=(f.prototype={changed:true})){}const old=f.prototype;const value=f();return [Object.getPrototypeOf(value)===old,Object.getPrototypeOf(value)===f.prototype]",
  "function* f(){} const p=Object.getPrototypeOf(f);const bound=f.bind(null);return [Object.hasOwn(bound,'prototype'),Object.getPrototypeOf(bound)===p,bound.prototype===p.prototype,Object.getPrototypeOf(bound())===f.prototype]",
  "function* f(){} const d=Object.getOwnPropertyDescriptor(f,'prototype');return [d.writable,d.enumerable,d.configurable,Object.getOwnPropertyNames(d.value)]",
  "function* f(){} const shared=Object.getPrototypeOf(f.prototype);f.prototype=null;return Object.getPrototypeOf(f())===shared",
  "function* f(){} const shared=Object.getPrototypeOf(f.prototype);f.prototype=3;return Object.getPrototypeOf(f())===shared",
  "function* f(){}const value=f();return [value instanceof f,value instanceof Object,f instanceof Object]",
  "async function* f(){}const value=f();return [value instanceof f,value instanceof Object,f instanceof Object]",
  "function* f(){}try{new f()}catch(e){return e.name}",
  "async function* f(){}try{new f()}catch(e){return e.name}",
  "const it=(function*(){yield 1})();const parent=Object.getPrototypeOf(Object.getPrototypeOf(it));return ['next','return','throw'].map(k=>{const d=Object.getOwnPropertyDescriptor(parent,k);return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable,Object.hasOwn(d.value,'prototype')]})",
  "const it=(function*(){})();const receiver={};const method=it[Symbol.iterator];return [method.call(receiver)===receiver,method.name,method.length]",
  "const it=(async function*(){})();const receiver={};const method=it[Symbol.asyncIterator];return [method.call(receiver)===receiver,method.name,method.length]",
  "const it=(function*(){})();delete Object.getPrototypeOf(Object.getPrototypeOf(it)).next;return typeof it.next",
  "const it=(function*(){})();delete Object.getPrototypeOf(Object.getPrototypeOf(it))[Symbol.toStringTag];return Object.prototype.toString.call(it)",
  "const it=(async function*(){})();delete Object.getPrototypeOf(Object.getPrototypeOf(it))[Symbol.toStringTag];return Object.prototype.toString.call(it)",
  "const it=(function*(){yield 1})();delete Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(it)))[Symbol.iterator];try{Array.from(it);return 'array-like'}catch(e){return e.name}"
])("preserves generator graph semantics: %s", async source => {
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it.each(["next", "return", "throw"])("brand-checks borrowed %s methods", async method => {
  const source = `const sync=(function*(){yield 1})();const async=(async function*(){yield 2})();const trace=[];
    for(const receiver of [{},async]){try{sync.${method}.call(receiver,3);trace.push('accepted')}catch(e){trace.push(e.name)}}
    for(const receiver of [{},sync]){let result;try{result=async.${method}.call(receiver,3);trace.push(result instanceof Promise)}catch(e){trace.push('sync throw')}
      try{await result}catch(e){trace.push(e.name)}}return trace`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: await runInNewContext(`(async function(){${source}})()`) });
});

it("uses synchronous generator protocols through for-await", async () => {
  const source = "const values=[];for await(const value of (function*(){yield Promise.resolve(3);yield 4})()){values.push(value)}return values";
  expect(await run(source)).toMatchObject({ok:true,returnValue:await runInNewContext(`(async function(){${source}})()`)});
});

it("inherits the shared Iterator tag accessor and its receiver-sensitive setter", async () => {
  const source = `const p=Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));const d=Object.getOwnPropertyDescriptor(p,Symbol.toStringTag);
    const trace=[d.enumerable,d.configurable,d.get.name,d.get.length,d.set.name,d.set.length,d.get.call(null)];
    for(const target of [p,{},Object.create(p),1,null,Object.preventExtensions({})]){try{d.set.call(target,'custom');trace.push(Object.getOwnPropertyDescriptor(target,Symbol.toStringTag))}catch(e){trace.push(e.name)}}return trace`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it.each([
  "function* f(){yield 1;yield 2}const value=f();const next=value.next;const first=next.call(value);await pause();return [first,next===value.next,Object.getPrototypeOf(value)===f.prototype,next.call(value)]",
  "async function* f(){yield 1;yield 2}const value=f();const next=value.next;const first=await next.call(value);await pause();return [first,next===value.next,Object.getPrototypeOf(value)===f.prototype,await next.call(value)]",
  "function* f(){}const value=f();const prototype=Object.getPrototypeOf(f.prototype);prototype.next=function(){return {done:true,value:this.extra}};value.extra=7;Object.freeze(f.prototype);await pause();return [value.next(),Object.isFrozen(f.prototype),Object.getPrototypeOf(value)===f.prototype]",
  "const it=(async function*(){})();const factory=it[Symbol.asyncIterator];const prototype=Object.getPrototypeOf(Object.getPrototypeOf(it));delete prototype[Symbol.toStringTag];await pause();return [factory===it[Symbol.asyncIterator],factory.call(it)===it,Object.prototype.toString.call(it)]",
  "function* f(x=(f.prototype={},pause())){}f.prototype.extra=7;const value=f();return value.extra",
  "async function* f(x=(f.prototype={},pause())){}f.prototype.extra=7;const value=f();return value.extra"
])("preserves generator intrinsic graphs across a pending effect: %s", async source => {
  let release!: () => void;
  let signalEntered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { signalEntered = resolve; });
  const pause = declareHostOperation(async () => { signalEntered(); await pending; }, "re-issue");
  const execution = run(source, { bindings: { pause } });
  void execution.catch(() => undefined);
  let serialized: string;
  try {
    await Promise.race([entered, execution]);
    serialized = await dump(execution, { mode: "replay" });
  } finally { release(); }
  const expected = await runInNewContext(`(async function(){const pause=async()=>{};${source}})()`);
  expect(await execution).toMatchObject({ok:true,returnValue:expected});
  expect(await run(source, { snapshot: restore(JSON.parse(serialized), { source }),
    bindings: { pause: declareHostOperation(async () => undefined, "re-issue") } })).toMatchObject({ok:true,returnValue:expected});
});

it.each([false, true])("retains shared generator prototype mutations (async=%s)", async => {
  const budget = new Budget({dataSize:100});
  createBuiltinBindings({budget});
  try {
    generatorPrototypes.get(budget)!.get(async)!.instancePrototype.extra = "x".repeat(1000);
    expect(() => reconcileCompiledValues(budget, [])).toThrow(SandboxError);
  } finally { releaseObjectPrototype(budget); }
});

it.each([false, true])("retains shared generator iterator-method metadata (async=%s)", async => {
  const budget = new Budget({dataSize:100});
  createBuiltinBindings({budget});
  try {
    const prototype = generatorPrototypes.get(budget)!.get(async)!.instancePrototype;
    const method = getSandboxDataProperty(prototype, async ? Symbol.asyncIterator : Symbol.iterator, budget);
    if (!isSandboxClosure(method)) throw new Error("Missing iterator method");
    materializeFunctionProperties(method).extra = "x".repeat(1000);
    expect(() => reconcileCompiledValues(budget, [])).toThrow(SandboxError);
  } finally { releaseObjectPrototype(budget); }
});

it("keeps generator dynamic-source constructors inside the guest realm", async () => {
  expect(await run("function* f(){}async function* g(){}return [typeof GeneratorFunction,typeof AsyncGeneratorFunction,f.constructor.name,g.constructor.name,f().constructor===Object.getPrototypeOf(f),g().constructor===Object.getPrototypeOf(g),f.constructor('return typeof process')().next().value,(await g.constructor('return typeof process')().next()).value]"))
    .toMatchObject({ok:true,returnValue:["undefined","undefined","GeneratorFunction","AsyncGeneratorFunction",true,true,"undefined","undefined"]});
});

it.each([false, true])("retains the selected prototype during parameter initialization (async=%s)", async async => {
  const budget = new Budget({dataSize:100000});
  let retained = 0;
  const inspect = declareHostOperation(() => { retained = measureSandboxData(budget.retainedValues()); }, "re-issue");
  const source = `${async ? "async " : ""}function* f(x=(f.prototype={},inspect())){}f.prototype.extra='x'.repeat(10000);const value=f();return Object.getPrototypeOf(value).extra.length`;
  expect(await run(source, {budget,bindings:{inspect}})).toMatchObject({ok:true,returnValue:10000});
  expect(retained).toBeGreaterThan(10000);
});

it.each([false, true])("restores generator prototype and borrowed method identity without reexecution (async=%s)", async async => {
  const source = `${async ? "async " : ""}function* f(){yield 1;yield 2}const iterator=f();await iterator.next();return [f,iterator,iterator.next]`;
  const original = await run(source);
  expect(original.ok).toBe(true);
  const saved = serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{pair:original.returnValue as RuntimeSnapshotValue}}],
    callStack:[],pendingPromises:[],moduleBindings:{}});
  const restored = restoreGraph(JSON.parse(JSON.stringify(saved)), {source});
  const binding = restored.currentScope.lookup("pair");
  if (!binding.found || !Array.isArray(binding.value)) throw new Error("Missing restored pair");
  const [fn, iterator, next] = binding.value;
  if (!isSandboxClosure(fn) || !isSandboxGenerator(iterator) || !isSandboxClosure(next)) throw new Error("Missing restored generator graph");
  expect(getSandboxPrototype(iterator, restored.budget)).toBe(getGuestFunctionProperty(fn,"prototype"));
  expect(getSandboxDataProperty(iterator,"next",restored.budget)).toBe(next);
  const created = await fn.call([]);
  if (!isSandboxGenerator(created)) throw new Error("Missing newly called restored generator");
  expect(getSandboxPrototype(created, restored.budget)).toBe(getGuestFunctionProperty(fn,"prototype"));
  const result = await next.call([], {stack:[],thisValue:iterator});
  expect(isSandboxPromise(result) ? await result.promise : result).toEqual({value:2,done:false});
});

it.each([false, true])("restores the pre-intrinsic generator heap shape (async=%s)", async async => {
  const source = `${async ? "async " : ""}function* f(){yield 1}return [Math.abs,f,f()]`;
  const original = await run(source);
  const saved = JSON.parse(JSON.stringify(serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"external",bindings:{pair:original.returnValue as RuntimeSnapshotValue}}],
    callStack:[],pendingPromises:[],moduleBindings:{}})));
  // Earlier jobs-v8 heaps had neither the function's own prototype property nor
  // explicit generator links. Preserve that admitted shape, not a forged new one.
  for (const node of Object.values(saved.heap) as Array<{kind:string;state?:{prototype?:unknown;properties:{properties:Array<[unknown,unknown]>}};objectState?:{prototype?:unknown}}>) {
    if (node.kind === "guest-function" && node.state !== undefined) {
      delete node.state.prototype;
      node.state.properties.properties = node.state.properties.properties.filter(([key]) => key !== "prototype");
    }
    if (node.kind === "guest-generator" && node.objectState !== undefined) delete node.objectState.prototype;
  }
  const restored = restoreGraph(saved,{source});
  const binding = restored.currentScope.lookup("pair");
  if (!binding.found || !Array.isArray(binding.value)) throw new Error("Missing restored pair");
  const [, fn, iterator] = binding.value;
  if (!isSandboxClosure(fn) || !isSandboxGenerator(iterator)) throw new Error("Missing legacy generator");
  expect(getGuestFunctionProperty(fn,"prototype")).toBeUndefined();
  expect(getSandboxPrototype(iterator)).toBeNull();
});

it.each([false, true])("restores generator intrinsic fallback without an intrinsic heap reference (async=%s)", async async => {
  const source = `${async ? "async " : ""}function* f(){}f.prototype=null;Object.setPrototypeOf(f,null);return f`;
  const original = await run(source);
  const saved = serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{fn:original.returnValue as RuntimeSnapshotValue}}],
    callStack:[],pendingPromises:[],moduleBindings:{}});
  const restored = restoreGraph(JSON.parse(JSON.stringify(saved)),{source});
  const binding = restored.currentScope.lookup("fn");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing restored function");
  const created = await binding.value.call([]);
  if (!isSandboxGenerator(created)) throw new Error("Missing restored generator");
  const expected = generatorPrototypes.get(restored.budget)?.get(async)?.instancePrototype;
  expect(expected).toBeDefined();
  expect(getSandboxPrototype(created,restored.budget)).toBe(expected);
});

it.each([false, true])("initializes the realm for generators created by a restored ordinary function (async=%s)", async async => {
  const source = `function make(){return ${async ? "async " : ""}function*(){yield 1}}return make`;
  const original = await run(source);
  const saved = serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{make:original.returnValue as RuntimeSnapshotValue}}],
    callStack:[],pendingPromises:[],moduleBindings:{}});
  const restored = restoreGraph(JSON.parse(JSON.stringify(saved)),{source});
  const binding = restored.currentScope.lookup("make");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing restored factory");
  const fn = await binding.value.call([]);
  if (!isSandboxClosure(fn)) throw new Error("Missing generated function");
  const prototype = getGuestFunctionProperty(fn,"prototype");
  expect(prototype).toBeDefined();
  const iterator = await fn.call([]);
  if (!isSandboxGenerator(iterator)) throw new Error("Missing generated iterator");
  expect(getSandboxPrototype(iterator,restored.budget)).toBe(prototype);
});

it.each([false, true])("releases selected prototype retention when parameter initialization throws (async=%s)", async async => {
  const budget = new Budget({dataSize:100000});
  let retained = 10000;
  const inspect = declareHostOperation(() => { retained = measureSandboxData(budget.retainedValues()); }, "re-issue");
  const source = `${async ? "async " : ""}function* f(x=(f.prototype={},(()=>{throw 1})())){}f.prototype.extra='x'.repeat(10000);let caught=false;try{f()}catch(e){caught=e===1}inspect();return caught`;
  expect(await run(source,{budget,bindings:{inspect}})).toMatchObject({ok:true,returnValue:true});
  expect(retained).toBeLessThan(1000);
});

it("preserves the implicit generator projection for legacy execution", async () => {
  await withRunResources(undefined, async () => {
    runResources.getStore()!.functionSourceText = false;
    const budget = new Budget();
    const bindings = createBuiltinBindings({budget});
    try {
      const ast = parseModule("{function* f(){yield 1}const value=f();return [typeof f.prototype,typeof value[Symbol.iterator],value.next===value.next,value.next()]}");
      expect(await interpret(ast.body[0],{budget,bindings})).toMatchObject({ok:true,returnValue:["undefined","undefined",false,{value:1,done:false}]});
    } finally { releaseObjectPrototype(budget); }
  });
});

it.each([
  "const value=(function*(){yield ['original',1]})();let count=0;value.next=()=>count++?{done:true}:{done:false,value:['override',2]};return value",
  "const value=(function*(){yield ['original',1]})();let count=0;Object.defineProperty(value,'next',{get(){return ()=>count++?{done:true}:{done:false,value:['getter',3]}}});return value",
  "const value=(function*(){yield ['original',1]})();let count=0;value[Symbol.iterator]=()=>({next(){return count++?{done:true}:{done:false,value:['factory',4]}}});return value"
])("honors public generator protocols in contextless host adapters: %s", async source => {
  const original = await run(source);
  expect(original.ok).toBe(true);
  const budget = new Budget();
  const transform = createObjectArrayGlobals({budget}).Object.properties!.fromEntries;
  if (!isSandboxClosure(transform)) throw new Error("Missing fromEntries");
  try {
    const result = transform.call([original.returnValue]);
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toEqual(Object.fromEntries(runInNewContext(`(function(){${source}})()`)));
  } finally { releaseObjectPrototype(budget); }
});

it("closes the public generator protocol after a contextless adapter rejects an entry", async () => {
  const original = await run("const value=(function*(){yield 1})();value.return=function(){this.closed=true;return {done:true}};return value");
  if (!isSandboxGenerator(original.returnValue)) throw new Error("Missing generator");
  const budget = new Budget();
  const transform = createObjectArrayGlobals({budget}).Object.properties!.fromEntries;
  if (!isSandboxClosure(transform)) throw new Error("Missing fromEntries");
  try {
    await expect(transform.call([original.returnValue])).rejects.toThrow(TypeError);
    expect(getGeneratorProperties(original.returnValue).closed).toBe(true);
  } finally { releaseObjectPrototype(budget); }
});

it("uses the receiver when borrowing async generator next", async () => {
  const source = "const first=(async function*(){yield 1})();const second=(async function*(){yield 2})();return await first.next.call(second)";
  const native = new Function(`return async function(){${source}}`)() as () => Promise<unknown>;
  expect((await run(source)).returnValue).toEqual(await native());
});
