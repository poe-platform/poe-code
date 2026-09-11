import { describe, expect, it } from "vitest";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { RuntimeValues, type RuntimeValue, type TypeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { prepareClass } from "./class-preparation.js";
import { readRuntimeGetsetDescriptor, mutateRuntimeGetsetDescriptor } from "./runtime-getset-descriptor.js";

function fixture() {
  const budget = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000 }); let failAllocation = false;
  const meter = { checkpoint(steps = 1, bytes = 0) { if (failAllocation && bytes > 0) throw new ExecutionLimitError("allocation"); budget.checkpoint(steps, bytes); } };
  const values = new RuntimeValues(meter), hash = { none: values.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  const keys = { hash: (k: RuntimeValue) => runtimeHash(k, hash, meter), equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, values, meter).value };
  const registry = new RuntimeTypeRegistry(values, keys, meter);
  const layout = (name: string, bases = [registry.object.value]) => new RuntimeTypeLayout(name, bases, values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)), meter);
  return { registry, layout, values, meter, fail: (value: boolean) => { failAllocation = value; } };
}

describe("canonical runtime type registry", () => {
  it("selects canonical native types without synthesizing placeholder types",()=>{
    const {registry,values:v}=fixture();
    for(const [value,expected] of [
      [v.none,registry.noneType()],[v.notImplemented,registry.sentinelType("not-implemented")],[v.ellipsis,registry.sentinelType("ellipsis")],
      [v.true,registry.booleanType()],[v.integer(7),registry.integerType()],[v.float(1),registry.floatType()],
      [v.list([]),registry.listType()],[v.tuple([]),registry.tupleType()],[v.cell({}),registry.cellType()]
    ] as const)expect(registry.nativeType(value)).toBe(expected);
    expect(registry.nativeType(v.string("canonical string"))).toBe(registry.stringType());
    expect(registry.nativeType(v.bytes(new Uint8Array()))).toBeUndefined();
  });
  it("retains published instance and metaclass identities during type selection",()=>{
    const {registry,values:v,layout}=fixture(),owner=registry.publish(layout("Owned"),registry.type),instance=v.instance(owner);
    expect(registry.nativeType(instance)).toBe(owner);expect(registry.nativeType(owner)).toBe(registry.type);
    expect(registry.nativeType(registry.type)).toBe(registry.type);
  });
  it.each([["find",false],["find",true],["startswith",false],["startswith",true]] as const)("preserves cancellation from string search index lookup: %s throws=%s",(name,throws)=>{
    const {registry,values:v}=fixture(),owner=registry.stringType(),slot=owner.value.namespace.items.lookup(v.string(name))?.value;
    if(slot?.kind!=="method_descriptor")throw Error("expected search descriptor");
    const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}),keywords=v.dictionary(owner.value.namespace.items.emptyCopy());
    expect(()=>slot.value.invoke(v.string("abc"),[v.string("a"),v.cell({})],keywords,meter,{call(){throw Error("unexpected call");},integerIndex:{integer:()=>undefined,isExactInteger:value=>value.kind==="int",typeName:()=>"Index",warn(){throw Error("unexpected warning");},lookupIndex(){controller.abort();if(throws)throw Error("lookup failed");return ()=>v.integer(0);}}})).toThrow(ExecutionLimitError);
  });
  it("publishes canonical string allocation and core descriptors atomically",()=>{
    const state=fixture();state.fail(true);expect(()=>state.registry.stringType()).toThrow(ExecutionLimitError);state.fail(false);
    const owner=state.registry.stringType();expect(state.registry.stringType()).toBe(owner);
    expect(owner.value.variableSized).toBe(false);expect(owner.value.matchSelf).toBe(true);
    for(const name of ["__str__","__repr__","__hash__","__len__","__getitem__","__iter__","__contains__","__eq__","__ne__","__lt__","__le__","__gt__","__ge__"]){
      const slot=owner.value.namespace.items.lookup(state.values.string(name))?.value;
      expect(slot?.kind).toBe("wrapper_descriptor");
    }
  });
  it.each([false,true])("preserves cancellation through canonical string hashing (throws=%s)",throws=>{
    const {registry,values:v}=fixture(),owner=registry.stringType(),slot=owner.value.namespace.items.lookup(v.string("__hash__"))?.value;
    if(slot?.kind!=="wrapper_descriptor")throw Error("expected string hash slot");
    const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
    const keywords=v.dictionary(owner.value.namespace.items.emptyCopy());
    expect(()=>slot.value.invoke(v.string("x"),[],keywords,meter,{call(){throw Error("unexpected call");},nativeHash(){controller.abort();if(throws)throw Error("hash failed");return 17n;}})).toThrow(ExecutionLimitError);
  });
  it.each(["staticmethod","classmethod"] as const)("selects canonical or published %s ownership without inspecting its callable",kind=>{
    const {registry,values:v,layout}=fixture(),base=registry.methodDecoratorType(kind);
    expect(registry.nativeType(v.methodDecorator(kind,v.none))).toBe(base);
    const subclass=registry.publish(layout("OwnedDecorator",[base.value]),registry.type);
    expect(registry.nativeType(v.methodDecorator(kind,v.none,subclass))).toBe(subclass);
  });
  it("selects concrete callable and descriptor types without invoking their bodies",()=>{
    const {registry,values:v}=fixture(),unused=():never=>{throw Error("unexpected invocation");};
    expect(registry.nativeType(v.builtinFunction({name:"host",invoke:unused}))).toBe(registry.boundCallableType("builtin_function_or_method"));
    expect(registry.nativeType(v.wrapperDescriptor({owner:registry.object,name:"__repr__",accepts:()=>true,invoke:unused}))).toBe(registry.descriptorType("wrapper_descriptor"));
    expect(registry.nativeType(v.methodDescriptor({owner:registry.object,name:"method",accepts:()=>true,invoke:unused}))).toBe(registry.descriptorType("method_descriptor"));
    const dictionary=v.dictionary(registry.object.value.namespace.items.emptyCopy());
    expect(registry.nativeType(dictionary)).toBe(registry.dictionaryType());
  });
  it("keeps failed lazy type selection recoverable without a partially published type",()=>{
    const state=fixture();state.fail(true);
    expect(()=>state.registry.nativeType(state.values.none)).toThrow(ExecutionLimitError);
    state.fail(false);expect(state.registry.nativeType(state.values.none)).toBe(state.registry.noneType());
  });
  it("owns all six cell rich comparison descriptors",()=>{
    const {registry,values:v}=fixture(),owner=registry.cellType();
    for(const name of ["__eq__","__ne__","__lt__","__le__","__gt__","__ge__"]){
      const slot=owner.value.namespace.items.lookup(v.string(name))?.value;
      expect(slot?.kind).toBe("wrapper_descriptor");
    }
  });
  it("publishes canonical cell types only after successful initialization",()=>{
    const state=fixture();state.fail(true);
    expect(()=>state.registry.cellType()).toThrow(ExecutionLimitError);state.fail(false);
    const type=state.registry.cellType();expect(state.registry.cellType()).toBe(type);
    expect(type.value.namespace.items.lookup(state.values.string("__hash__"))?.value).toBe(state.values.none);
    expect(type.value.namespace.items.lookup(state.values.string("cell_contents"))?.value.kind).toBe("getset_descriptor");
  });
  it("validates direct cell allocation arguments before allocating independent storage",()=>{
    const {registry,values:v,meter}=fixture(),type=registry.cellType();
    const builtin=type.value.namespace.items.lookup(v.string("__new__"))!.value;
    if(builtin.kind!=="builtin_function_or_method")throw Error("expected constructor");
    const keywords=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>1n,equal:(a,b)=>a===b},meter));
    const call=(args:RuntimeValue[])=>builtin.value.invoke(args,keywords,meter);
    expect(()=>call([])).toThrow("cell.__new__(): not enough arguments");
    expect(()=>call([v.integer(1)])).toThrow("cell.__new__(X): X is not a type object (int)");
    expect(()=>call([registry.object])).toThrow("cell.__new__(object): object is not a subtype of cell");
    expect(()=>call([type,v.none,v.true])).toThrow("cell expected at most 1 argument, got 2");
    const first=call([type,v.none]),second=call([type,v.none]);expect(first).not.toBe(second);
    keywords.items.set(v.string("contents"),v.true);
    expect(()=>call([type,v.none,v.true])).toThrow("cell() takes no keyword arguments");
    expect(()=>call([])).toThrow("cell.__new__(): not enough arguments");
  });
  it("does not publish partially initialized descriptor types on allocation failure", () => {
    const state = fixture(); state.fail(true);
    expect(() => state.registry.descriptorType("member_descriptor")).toThrow(ExecutionLimitError);
    state.fail(false);
    const owner = state.registry.descriptorType("member_descriptor");
    expect(state.registry.descriptorType("member_descriptor")).toBe(owner);
    for (const name of ["__get__", "__set__", "__delete__"]) expect(owner.value.namespace.items.lookup(state.values.string(name))?.value.kind).toBe("wrapper_descriptor");
  });
  it.each(["__name__", "__qualname__"] as const)("installs intrinsic %s getsets with immutable and deletion guards", name => {
    const { registry, values, meter, layout } = fixture(), cls = registry.publish(layout("C"), registry.type);
    const descriptor = registry.type.value.namespace.items.lookup(values.string(name))!.value;
    if (descriptor.kind !== "getset_descriptor") throw Error("expected name getset");
    expect(readRuntimeGetsetDescriptor(descriptor, cls, registry.type, meter)).toEqual(values.string("C"));
    expect(() => mutateRuntimeGetsetDescriptor(descriptor, cls, { kind: "delete" }, meter)).toThrow(`cannot delete '${name}' attribute of immutable type 'C'`);
    for (const builtin of [registry.type, registry.object]) for (const change of [{ kind: "set", value: values.string("new") }, { kind: "delete" }] as const) {
      expect(() => mutateRuntimeGetsetDescriptor(descriptor, builtin, change, meter)).toThrow(`cannot set '${name}' attribute of immutable type '${builtin.value.name}'`);
    }
    const assigned = values.string("Changed"); mutateRuntimeGetsetDescriptor(descriptor, cls, { kind: "set", value: assigned }, meter);
    expect(readRuntimeGetsetDescriptor(descriptor, cls, registry.type, meter)).toBe(assigned);
  });
  it("prepares qualified names independently of bases and namespace entries", () => {
    const { registry, values, meter, layout } = fixture(), base = layout("Base"), baseType = registry.publish(base, registry.type), namespace = layout("unused").namespace;
    const code = new RuntimeTypeLayout("C", [base], namespace, meter, { qualifiedName: "Outer.C" }), cls = registry.publish(code, registry.type);
    base.names.set("__name__", values.string("RenamedBase"), meter);
    expect(cls.value.name).toBe("C"); expect(code.names.get("__qualname__", values, meter)).toEqual(values.string("Outer.C"));
    expect(registry.metadata(cls, "mro").items).toEqual([cls, baseType, registry.object]);
  });
  it("bootstraps object and type with their canonical metaclass and inheritance identities", () => {
    const { registry } = fixture();
    expect(registry.type.metaclass).toBe(registry.type); expect(registry.object.metaclass).toBe(registry.type);
    expect(registry.resolve(registry.type.value)).toBe(registry.type); expect(registry.resolve(registry.object.value)).toBe(registry.object);
    expect(registry.metadata(registry.object, "bases").items).toEqual([]);
    expect(registry.metadata(registry.type, "bases").items).toEqual([registry.object]);
    expect(registry.metadata(registry.type, "mro").items).toEqual([registry.type, registry.object]); expect(Object.isFrozen(registry)).toBe(true);
  });
  it("publishes each layout once and rejects conflicting metaclasses", () => {
    const { registry, layout } = fixture(), code = layout("C"), cls = registry.publish(code, registry.type);
    expect(registry.publish(code, registry.type)).toBe(cls);
    const meta = registry.publish(layout("Meta", [registry.type.value]), registry.type);
    expect(() => registry.publish(code, meta)).toThrow("type layout already has a different metaclass"); expect(registry.resolve(code)).toBe(cls);
  });
  it("retains canonical type values in cached diamond MRO and bases tuples", () => {
    const { registry, layout } = fixture(), a = registry.publish(layout("A"), registry.type), b = registry.publish(layout("B"), registry.type);
    const cls = registry.publish(layout("C", [a.value, b.value]), registry.type), mro = registry.metadata(cls, "mro"), bases = registry.metadata(cls, "bases");
    expect(mro.items).toEqual([cls, a, b, registry.object]); expect(bases.items).toEqual([a, b]);
    expect(registry.metadata(cls, "mro")).toBe(mro); expect(registry.metadata(cls, "bases")).toBe(bases);
    expect(Object.isFrozen(mro.items)).toBe(true);
  });
  it("rejects foreign or unpublished types without substituting matching names", () => {
    const state = fixture(), other = fixture(), local = state.layout("C");
    expect(() => state.registry.publish(local, other.registry.type)).toThrow("metaclass is not owned by this type registry");
    const foreignBase = state.layout("Foreign", [other.registry.object.value]);
    expect(() => state.registry.publish(foreignBase, state.registry.type)).toThrow("base layout is not published in this type registry");
    expect(() => state.registry.resolve(local)).toThrow("type layout is not published in this registry");
    const impostor = state.values.type(state.registry.object.value, state.registry.type);
    expect(() => state.registry.metadata(impostor, "mro")).toThrow("type is not owned by this registry");
  });
  it("retains live namespace storage independently of cached immutable metadata", () => {
    const { registry, layout, values } = fixture(), code = layout("C"), cls = registry.publish(code, registry.type), mro = registry.metadata(cls, "mro");
    code.namespace.items.set(values.string("x"), values.true);
    expect(cls.value.namespace).toBe(code.namespace); expect(registry.metadata(cls, "mro")).toBe(mro);
  });
  it("supplies canonical metaclass MROs to class preparation", () => {
    const { registry, layout, values, meter } = fixture();
    const m1 = registry.publish(layout("M1", [registry.type.value]), registry.type), m2 = registry.publish(layout("M2", [m1.value]), registry.type);
    const a = registry.publish(layout("A"), m1), b = registry.publish(layout("B"), m2), namespace = layout("prepared").namespace;
    const result = prepareClass(values.string("C"), values.tuple<RuntimeValue>([a, b]), new Map<string, RuntimeValue>(), {
      defaultType: registry.type, tupleItems: value => value.kind === "tuple" ? value.items : undefined,
      isType: (value): value is TypeValue => value.kind === "type",
      typeOf: value => { if (value.kind !== "type") throw new Error("expected type"); return value.metaclass; },
      mro: value => { if (value.kind !== "type") throw new Error("expected type"); return registry.metadata(value, "mro").items; },
      typeName: value => { if (value.kind !== "type") throw new Error("expected type"); return value.value.name; },
      lookupPrepare: selected => { expect(selected).toBe(m2); return undefined; },
      callPrepare: () => { throw new Error("unexpected prepare hook"); }, emptyNamespace: () => namespace, isMapping: value => value.kind === "dict"
    }, meter);
    expect(result.metaclass).toBe(m2); expect(result.namespace).toBe(namespace);
  });
  it("does not publish a record or cache a metadata tuple after allocation failure", () => {
    const state = fixture(), code = state.layout("C"); state.fail(true);
    expect(() => state.registry.publish(code, state.registry.type)).toThrow(ExecutionLimitError); state.fail(false);
    expect(() => state.registry.resolve(code)).toThrow("type layout is not published in this registry");
    const cls = state.registry.publish(code, state.registry.type); state.fail(true);
    expect(() => state.registry.metadata(cls, "mro")).toThrow(ExecutionLimitError); state.fail(false);
    const mro = state.registry.metadata(cls, "mro"); expect(mro.items).toEqual([cls, state.registry.object]); expect(state.registry.metadata(cls, "mro")).toBe(mro);
  });
});
