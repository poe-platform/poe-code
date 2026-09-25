import { afterEach, expect, it, vi } from "vitest";
import {
  Budget,
  createRealm,
  defineExtension,
  type ExtensionContext,
  type HostObject,
  type HostObjectDefinition
} from "./core.js";

const realms: ReturnType<typeof createRealm>[] = [];
afterEach(async () => {
  for (const realm of realms.splice(0)) await realm.close();
});

function fixture(
  options: {
    definition?: HostObjectDefinition;
    budget?: Budget;
    guard?: () => void;
    keepReference?: boolean;
  } = {}
) {
  let context!: ExtensionContext;
  let host!: HostObject;
  let reference: unknown;
  const read = vi.fn(() => undefined);
  const realm = createRealm({
    budget: options.budget,
    grants: ["guest:retain"],
    extensions: [
      defineExtension({
        manifest: {
          version: 1,
          name: "prototype",
          globals: ["lookup", "install", "clear"],
          capabilities: ["guest:retain"]
        },
        setup(owner) {
          context = owner;
          host = owner.createHostObject({
            expandos: { maxKeys: 8, maxKeyCodeUnits: 128 },
            properties: { native: { get: () => 21 }, shadow: { get: read } },
            ...options.definition
          });
          const install = owner.retainGuestArguments((value: unknown) => {
            reference = value;
            try {
              owner.setHostObjectPrototype(host, value, options.guard);
            } finally {
              if (!options.keepReference) owner.releaseGuestReference(value);
            }
          }, 0);
          return {
            globals: {
              lookup: () => host,
              install,
              clear: () => owner.setHostObjectPrototype(host, null)
            }
          };
        }
      })
    ]
  });
  realms.push(realm);
  return {
    realm,
    read,
    get context() {
      return context;
    },
    get reference() {
      return reference;
    },
    get host() {
      return host;
    }
  };
}

it("preserves ordinary method lookup, capture identity, overrides and restoration", async () => {
  const { realm } = fixture();
  expect(
    await realm.evaluate(`
    const node=lookup(); const prototype={focus(){return this.native*2}}; install(prototype);
    const captured=node.focus; const before=node.focus===prototype.focus;
    let calls=0; prototype.focus=function(){calls++;return captured.call(this)+1};
    const current=node.focus(); const saved=captured.call(node); prototype.focus=captured;
    return [before,current,saved,calls,node.focus===captured,node.focus()];
  `)
  ).toMatchObject({ ok: true, returnValue: [true, 43, 42, 1, true, 42] });
});

it("preserves native shadowing, undefined values, symbol identity and receiver getters", async () => {
  const { realm, read } = fixture();
  expect(
    await realm.evaluate(`
    const node=lookup();const symbol=Symbol("method");
    const prototype={native:99,shadow:99,[symbol](){return this.native},get doubled(){return this.native*2}};
    install(prototype);
    return [node.native,node.shadow===undefined,node[symbol](),node.doubled,
      Object.getPrototypeOf(node)===prototype,Reflect.getPrototypeOf(node)===prototype,
      Reflect.get(node,"doubled"),Reflect.has(node,"doubled"),"doubled" in node,
      Object.hasOwn(node,"doubled"),Object.keys(node).includes("doubled")];
  `)
  ).toMatchObject({
    ok: true,
    returnValue: [21, true, 21, 42, true, true, 42, true, true, false, false]
  });
  expect(read).toHaveBeenCalledTimes(1);
});

it("keeps guest writes distinct from inherited setters and readonly properties", async () => {
  const { realm } = fixture();
  expect(
    await realm.evaluate(`
    const node=lookup();const prototype={set chosen(value){this.saved=value},method(){return 1}};
    Object.defineProperty(prototype,"locked",{value:7,writable:false});install(prototype);
    node.chosen=42;node.method=()=>2;let denied=false;
    try{node.locked=8}catch(error){denied=error instanceof TypeError}
    return [node.saved,Object.hasOwn(node,"chosen"),node.method(),prototype.method(),denied,node.locked];
  `)
  ).toMatchObject({ ok: true, returnValue: [42, false, 2, 1, true, 7] });
});

it("enumerates inherited fields without treating them as own properties", async () => {
  const { realm } = fixture();
  expect(
    await realm.evaluate(`
    const node=lookup();install({inherited:1,native:99});const keys=[];for(const key in node)keys.push(key);
    return [keys.includes("inherited"),keys.filter(key=>key==="native").length,Object.keys(node).includes("inherited")];
  `)
  ).toMatchObject({ ok: true, returnValue: [true, 1, false] });
});

it("retains mutable prototype graphs after the installation reference is released", async () => {
  const budget = new Budget({ dataSize: 30000 });
  const { realm } = fixture({ budget });
  expect(await realm.evaluate('install({payload:"x".repeat(4096)});return 1')).toMatchObject({
    ok: true
  });
  const retained = budget.currentDataSize;
  expect(retained).toBeGreaterThanOrEqual(4096);
  expect(
    await realm.evaluate(
      'Object.getPrototypeOf(lookup()).payload="y".repeat(8192);return lookup().payload.length'
    )
  ).toMatchObject({ ok: true, returnValue: 8192 });
  expect(budget.currentDataSize).toBeGreaterThan(retained + 3500);
  expect(await realm.evaluate("clear();return lookup().payload===undefined")).toMatchObject({
    ok: true,
    returnValue: true
  });
  expect(budget.currentDataSize).toBeLessThan(retained - 3500);
  await realm.close();
  expect(budget.currentDataSize).toBe(0);
});

it("enforces fatal quotas for linked descendant mutation", async () => {
  const { realm } = fixture({ budget: new Budget({ dataSize: 10000 }) });
  expect(
    await realm
      .evaluate(
        'install({});try{Object.getPrototypeOf(lookup()).payload="x".repeat(20000)}catch(error){}return 1'
      )
      .catch((error) => ({ ok: false, error }))
  ).toMatchObject({
    ok: false,
    error: { code: "budgetExceeded", budget: "dataSize" }
  });
});

it("rejects primitives and live capabilities as prototypes without changing a valid link", async () => {
  const { realm } = fixture();
  expect(
    await realm.evaluate(`
    const node=lookup();const prototype={good:42};install(prototype);let denied=0;
    for(const value of [undefined,7,"bad",node]){try{install(value)}catch(error){if(error instanceof TypeError)denied++}}
    return [denied,node.good,Object.getPrototypeOf(node)===prototype];
  `)
  ).toMatchObject({ ok: true, returnValue: [4, 42, true] });
});

it("rejects foreign host objects and retained references", async () => {
  const first = fixture();
  const second = fixture({ keepReference: true });
  await first.realm.evaluate("return 1");
  await second.realm.evaluate("install({value:42});return 1");
  expect(() => first.context.setHostObjectPrototype(second.host, null)).toThrow("Foreign");
  expect(() => first.context.setHostObjectPrototype(first.host, {})).toThrow("reference");
  expect(() => first.context.setHostObjectPrototype(first.host, second.reference)).toThrow(
    "Foreign"
  );
});

it("guards prototype reads without enabling guest expandos", async () => {
  let closed = false;
  const test = fixture({
    definition: { expandos: undefined },
    guard() {
      if (closed) throw new Error("publisher closed");
    }
  });
  expect(await test.realm.evaluate("install({value:42});return lookup().value")).toMatchObject({
    ok: true,
    returnValue: 42
  });
  closed = true;
  expect(
    await test.realm.evaluate(
      'let denied=0;for(const operation of [()=>lookup().value,()=>Object.getPrototypeOf(lookup()),()=>Reflect.getPrototypeOf(lookup()),()=>"value" in lookup(),()=>Reflect.has(lookup(),"value")]){try{operation()}catch(error){if(error.message==="publisher closed")denied++}}return denied'
    )
  ).toMatchObject({ ok: true, returnValue: 5 });
});

it("preserves primary prototype accounting during reconciliation holds", async () => {
  const budget = new Budget({ dataSize: 18000 });
  const test = fixture({ budget });
  expect(await test.realm.evaluate('install({payload:"x".repeat(4096)});return 1')).toMatchObject({
    ok: true
  });
  const release = budget.deferReconciliation();
  try {
    const result = await test.realm
      .evaluate(
        'try{Object.getPrototypeOf(lookup()).payload="x".repeat(14000)}catch(error){}return 1'
      )
      .catch((error) => ({ ok: false, error }));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "budgetExceeded", budget: "dataSize" }
    });
  } finally {
    release();
  }
});

it("rejects asynchronous prototype guards before committing a link", async () => {
  const test = fixture({ guard: async () => {} });
  expect(
    await test.realm.evaluate(
      "let denied=false;try{install({value:42})}catch(error){denied=error instanceof TypeError}return [denied,lookup().value===undefined]"
    )
  ).toMatchObject({ ok: true, returnValue: [true, true] });
});

it("revokes native prototype access on publisher and realm close", async () => {
  let closed = false;
  const test = fixture({
    definition: {
      expandos: {
        maxKeys: 8,
        maxKeyCodeUnits: 128,
        assertActive() {
          if (closed) throw new Error("publisher closed");
        }
      }
    }
  });
  expect(await test.realm.evaluate("install({value:42});return lookup().value")).toMatchObject({
    ok: true,
    returnValue: 42
  });
  closed = true;
  expect(
    await test.realm.evaluate(
      'let denied=0;for(const operation of [()=>lookup().value,()=>Object.getPrototypeOf(lookup()),()=>Reflect.getPrototypeOf(lookup()),()=>"value" in lookup(),()=>Reflect.has(lookup(),"value")]){try{operation()}catch(error){if(error.message==="publisher closed")denied++}}return denied'
    )
  ).toMatchObject({ ok: true, returnValue: 5 });
  await test.realm.close();
  expect(() => test.context.setHostObjectPrototype(test.host, null)).toThrow(/closed|revoked/);
});

it("follows guest proxy prototypes with the original live receiver", async () => {
  const { realm } = fixture();
  expect(
    await realm.evaluate(`
    const node=lookup();const seen=[];const prototype=new Proxy({method(){return this.native}},
      {get(target,key,receiver){seen.push(receiver===node);return Reflect.get(target,key,receiver)}});
    install(prototype);return [node.method(),seen.every(value=>value)];
  `)
  ).toMatchObject({ ok: true, returnValue: [21, true] });
});

it("observes inherited proxy has traps through both in and Reflect.has", async () => {
  const { realm } = fixture();
  expect(
    await realm.evaluate(`
    const seen=[];install(new Proxy({}, {has(target,key){seen.push(key);return key==="virtual"}}));
    const node=lookup();return ["virtual" in node,Reflect.has(node,"virtual"),seen.join(",")];
  `)
  ).toMatchObject({ ok: true, returnValue: [true, true, "virtual,virtual"] });
});

it("uses the host receiver for inherited proxy setters and writable data", async () => {
  const { realm } = fixture();
  expect(
    await realm.evaluate(`
    const node=lookup();const seen=[];const target={value:1,set chosen(value){this.saved=value}};
    install(new Proxy(target,{set(target,key,value,receiver){seen.push(key+":"+(receiver===node));return Reflect.set(target,key,value,receiver)}}));
    node.chosen=7;node.value=2;
    return [node.saved,node.value,target.value,seen.join(","),Object.hasOwn(node,"chosen")];
  `)
  ).toMatchObject({ ok: true, returnValue: [7, 2, 1, "chosen:true,saved:true,value:true", false] });
});

it("respects non-enumerable inherited shadowing during for-in", async () => {
  const { realm } = fixture();
  expect(
    await realm.evaluate(`
    const base={hidden:1,visible:2};const prototype=Object.create(base);
    Object.defineProperty(prototype,"hidden",{value:3,enumerable:false});install(prototype);
    const keys=[];for(const key in lookup())keys.push(key);
    return [keys.includes("hidden"),keys.includes("visible")];
  `)
  ).toMatchObject({ ok: true, returnValue: [false, true] });
});

it("visits inherited indexes in borrowed array methods", async () => {
  const { realm } = fixture();
  expect(
    await realm.evaluate(`
    install({length:2,0:21,1:42});
    return Array.prototype.map.call(lookup(),value=>value*2);
  `)
  ).toMatchObject({ ok: true, returnValue: [42, 84] });
});

it("falls through absent indexed host members without hiding present undefined values", async () => {
  const { realm } = fixture({
    definition: { indexed: { length: () => 1, get: () => undefined, maxLength: 2 } }
  });
  expect(
    await realm.evaluate(`
    install({0:20,1:21,2:42});const node=lookup();
    return [node[0]===undefined,node[1],node[2],Reflect.get(node,"1"),"1" in node];
  `)
  ).toMatchObject({ ok: true, returnValue: [true, 21, 42, 21, true] });
});

it("keeps native receiver accessors protected from reflected data writes", async () => {
  const write = vi.fn();
  const { realm } = fixture({
    definition: { properties: { protected: { get: () => 21, set: write } } }
  });
  expect(
    await realm.evaluate(`
    install({});const node=lookup();const data={protected:1};
    return [Reflect.set(data,"protected",42,node),node.protected];
  `)
  ).toMatchObject({ ok: true, returnValue: [false, 21] });
  expect(write).not.toHaveBeenCalled();
});
