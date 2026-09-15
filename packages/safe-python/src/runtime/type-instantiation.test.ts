import { expect, it } from "vitest";
import { instantiateType, type TypeInstantiationContext } from "./type-instantiation.js";
import { ExecutionBudget } from "./execution-budget.js";

interface Value { name: string; type?: Value }
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
function fixture() {
  const owner = { name: "A" }, child = { name: "B" }, foreign = { name: "Other" }, none = { name: "NoneType" };
  const instance = { name: "instance", type: owner }, events: string[] = [], args = [none], keywords = new Map([["x", none]]);
  const context: TypeInstantiationContext<Value> = {
    lookupNew(type) { expect(type).toBe(owner); events.push("lookup-new"); return (type, positional, named) => {
      expect(type).toBe(owner); expect(positional).toBe(args); expect(named).toBe(keywords); events.push("new"); return instance;
    }; },
    typeOf(value) { events.push("type"); return value.type!; },
    isSubtype(actual, requested) { events.push("subtype"); expect(requested).toBe(owner); return actual === owner || actual === child; },
    lookupInit(value, actual) { expect(value).toBe(instance); expect(actual).toBe(instance.type); events.push(`lookup-init:${actual.name}`); return (positional, named) => {
      expect(positional).toBe(args); expect(named).toBe(keywords); events.push("init"); return none;
    }; },
    isNone: value => value === none, typeName: value => value.name
  };
  return { owner, child, foreign, none, instance, events, args, keywords, context };
}

it.each(["same", "subclass", "unrelated"])("initializes the actual returned type for %s new results", relation => {
  const state = fixture();
  state.instance.type = relation === "same" ? state.owner : relation === "subclass" ? state.child : state.foreign;
  const result = instantiateType(state.owner, state.args, state.keywords, state.context, budget());
  expect(result).toBe(state.instance);
  expect(state.events).toEqual(["lookup-new", "new", "type", "subtype", ...(relation === "unrelated" ? [] : [`lookup-init:${state.instance.type.name}`, "init"])]);
});

it("permits a missing initializer but not a missing allocator", () => {
  const state = fixture(); state.context.lookupInit = () => undefined;
  expect(instantiateType(state.owner, state.args, state.keywords, state.context, budget())).toBe(state.instance);
  state.context.lookupNew = () => undefined;
  expect(() => instantiateType(state.owner, state.args, state.keywords, state.context, budget())).toThrow("cannot create 'A' instances");
});

it("rejects non-None initializer results without rolling back initialization", () => {
  const state = fixture(); let initialized = false;
  state.context.lookupInit = () => () => { initialized = true; return { name: "answer", type: { name: "int" } }; };
  expect(() => instantiateType(state.owner, state.args, state.keywords, state.context, budget())).toThrow("__init__() should return None, not 'int'");
  expect(initialized).toBe(true);
});

it("names the actual metaclass when init returns a class", () => {
  const state = fixture();
  state.context.lookupInit = () => () => ({ name: "UserClass", type: { name: "type" } });
  expect(() => instantiateType(state.owner, state.args, state.keywords, state.context, budget())).toThrow("__init__() should return None, not 'type'");
});

it("resolves initialization after allocator mutations", () => {
  const state = fixture(), allocate = state.context.lookupNew(state.owner)!;
  state.context.lookupNew = () => (type, args, keywords) => {
    state.context.lookupInit = (value, actual) => { expect(value).toBe(state.instance); expect(actual).toBe(state.child); return () => { state.events.push("replacement-init"); return state.none; }; };
    state.instance.type = state.child;
    return allocate(type, args, keywords);
  };
  instantiateType(state.owner, state.args, state.keywords, state.context, budget());
  expect(state.events.at(-1)).toBe("replacement-init");
});

it.each(["lookupNew", "typeOf", "isSubtype", "lookupInit", "isNone", "typeName"] as const)("propagates %s callback failures unchanged", stage => {
  const state = fixture(), failure = new Error(stage);
  if (stage === "typeName") { state.context.isNone = () => false; state.context.lookupInit = () => () => state.instance; }
  state.context[stage] = (): never => { throw failure; };
  expect(() => instantiateType(state.owner, state.args, state.keywords, state.context, budget())).toThrow(failure);
});

it.each(["lookupNew", "typeOf", "isSubtype", "lookupInit", "isNone", "typeName"] as const)("observes cancellation after %s callbacks", stage => {
  const state = fixture(), controller = new AbortController();
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal: controller.signal });
  if (stage === "typeName") { state.context.isNone = () => false; state.context.lookupInit = () => () => state.instance; }
  const original = state.context[stage].bind(state.context);
  Object.assign(state.context, { [stage]: (...args: unknown[]) => { const result = Reflect.apply(original, undefined, args); controller.abort(); return result; } });
  expect(() => instantiateType(state.owner, state.args, state.keywords, state.context, meter)).toThrow("execution cancelled");
});

it.each(["new", "init"])("does not reinterpret %s failures or run later stages", stage => {
  const state = fixture(), failure = new Error("guest exception"), events: string[] = [];
  if (stage === "new") state.context.lookupNew = () => () => { events.push("new"); throw failure; };
  state.context.lookupInit = () => { events.push("lookup-init"); return () => { events.push("init"); throw failure; }; };
  expect(() => instantiateType(state.owner, state.args, state.keywords, state.context, budget())).toThrow(failure);
  expect(events).toEqual(stage === "new" ? ["new"] : ["lookup-init", "init"]);
});

it.each(["new", "init"])("observes cancellation after %s returns", stage => {
  const state = fixture(), controller = new AbortController();
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal: controller.signal });
  if (stage === "new") state.context.lookupNew = () => () => { controller.abort(); return state.instance; };
  else state.context.lookupInit = () => () => { controller.abort(); return state.none; };
  expect(() => instantiateType(state.owner, state.args, state.keywords, state.context, meter)).toThrow("execution cancelled");
});
