import { afterEach, expect, it, vi } from "vitest";
import type { CallerInjectedBinding } from "./interp/host-bridge.js";
import {
  Budget,
  createRealm,
  defineExtension,
  run,
  type ExtensionContext,
  type GuestReference,
  type HostObject
} from "./core.js";

const realms: ReturnType<typeof createRealm>[] = [];
afterEach(async () => {
  await Promise.all(realms.splice(0).map((realm) => realm.close()));
});

function fixture(
  setup: (context: ExtensionContext) => Record<string, unknown>,
  options: { limit?: number; budget?: Budget; signal?: AbortSignal } = {}
) {
  let context!: ExtensionContext;
  const budget = options.budget ?? new Budget({ maxSteps: 100000, dataSize: 1048576 });
  const realm = createRealm({
    budget,
    signal: options.signal,
    limits: { guestReferences: options.limit ?? 32 },
    grants: ["guest:retain"],
    extensions: [
      defineExtension({
        manifest: {
          version: 1,
          name: "constructors",
          globals: ["port"],
          capabilities: ["guest:retain"]
        },
        setup(ctx) {
          context = ctx;
          return { globals: { port: setup(ctx) as CallerInjectedBinding } };
        }
      })
    ]
  });
  realms.push(realm);
  return {
    realm,
    budget,
    get context() {
      return context;
    }
  };
}

it("constructs live objects through new, bind, Reflect and a subclass without losing aliases", async () => {
  const calls: unknown[][] = [];
  const test = fixture((ctx) => {
    const object = ctx.createHostObject({ properties: { value: { get: () => 42 } } });
    const Factory = ctx.createHostConstructor("Factory", (...args) => {
      calls.push([...args]);
      return object;
    });
    return { Factory, alias: Factory, object };
  });
  expect(
    await test.realm.evaluate(`
    const Factory = port.Factory;
    const input = { nested: [1] };
    class Child extends Factory {}
    const Bound = Factory.bind(null, input);
    return [Factory === port.alias, Factory.name, Factory.length,
      Factory.prototype.constructor === Factory, typeof Factory,
      new Factory(input, input) === port.object,
      new Bound(input) === port.object, new Child() === port.object,
      Reflect.construct(Factory, [], Child).value,
      new (new Proxy(Factory, {}))() === port.object];
  `)
  ).toMatchObject({
    ok: true,
    returnValue: [true, "Factory", 0, true, "function", true, true, true, 42, true]
  });
  expect(calls).toHaveLength(5);
  expect(calls[0][0]).toBe(calls[0][1]);
  expect(calls[1][0]).toBe(calls[1][1]);
});

it("rejects calls without new before invoking the host", async () => {
  const construct = vi.fn(() => {
    throw new Error("must not run");
  });
  const test = fixture((ctx) => ({ Factory: ctx.createHostConstructor("Factory", construct) }));
  expect(
    await test.realm.evaluate(`
    const errors = [];
    for (const call of [() => port.Factory(), () => port.Factory.call(null), () => port.Factory.apply(null, [])]) {
      try { call(); } catch (error) { errors.push(error instanceof TypeError); }
    }
    return errors;
  `)
  ).toMatchObject({ ok: true, returnValue: [true, true, true] });
  expect(construct).not.toHaveBeenCalled();
});

it("uses the declared argument retention policy and revokes failed construction captures", async () => {
  let retained: GuestReference | undefined;
  let fail = true;
  const test = fixture((ctx) => {
    const object = ctx.createHostObject({});
    const construct = ctx.retainGuestArguments((arg: unknown) => {
      retained = arg as GuestReference;
      if (fail) throw new TypeError("construction failed");
      return object;
    }, 0);
    return {
      Factory: ctx.createHostConstructor("Factory", construct),
      read: () => retained
    };
  });
  expect(
    await test.realm.evaluate("try { new port.Factory({x:1}); } catch(e) { return e.message; }")
  ).toMatchObject({ ok: true, returnValue: "construction failed" });
  expect(() => test.context.releaseGuestReference(retained)).toThrow(/revoked/);
  fail = false;
  expect(
    await test.realm.evaluate("const x={};new port.Factory(x);return port.read()===x;")
  ).toMatchObject({ ok: true, returnValue: true });
  test.context.releaseGuestReference(retained);
});

it.each(["plain", "primitive", "thenable", "promise", "proxy"])(
  "rejects %s construction results synchronously without reading user hooks",
  async (kind) => {
    const hook = vi.fn(() => {
      throw new Error("unexpected hook");
    });
    const test = fixture((ctx) => ({
      Factory: ctx.createHostConstructor("Factory", (() => {
        if (kind === "primitive") return 3;
        if (kind === "thenable")
          return {
            get then() {
              return hook();
            }
          };
        if (kind === "promise") return Promise.reject(new Error("invalid async result"));
        if (kind === "proxy") return new Proxy({}, { getPrototypeOf: hook, get: hook });
        return {};
      }) as () => HostObject)
    }));
    expect(
      await test.realm.evaluate(
        "try { new port.Factory();return false; } catch(e) {return e instanceof TypeError;}"
      )
    ).toMatchObject({ ok: true, returnValue: true });
    expect(hook).not.toHaveBeenCalled();
  }
);

it("validates names and synchronous callbacks without executing proxies or copying callback properties", async () => {
  const test = fixture(() => ({}));
  await test.realm.evaluate("0;");
  const hook = vi.fn(() => {
    throw new Error("unexpected hook");
  });
  const create = test.context.createHostConstructor;
  for (const name of ["", "x".repeat(1025), 1, new String("Factory")])
    expect(() =>
      create(name as string, () => {
        throw new Error();
      })
    ).toThrow(TypeError);
  for (const callback of [
    async () => ({}),
    function* () {},
    new Proxy(() => ({}), { get: hook }),
    {}
  ])
    expect(() => create("Factory", callback as () => HostObject)).toThrow(TypeError);
  const callback = () => {
    throw new TypeError("Illegal constructor");
  };
  Object.defineProperty(callback, "secret", { get: hook });
  expect(() => create("Factory", callback)).not.toThrow();
  expect(hook).not.toHaveBeenCalled();
});

it("rejects foreign constructors and foreign or revoked live results", async () => {
  let foreign!: HostObject;
  let constructor!: GuestReference;
  const first = fixture((ctx) => {
    foreign = ctx.createHostObject({});
    constructor = ctx.createHostConstructor("Factory", () => foreign);
    return {};
  });
  await first.realm.evaluate("0;");
  const second = fixture((ctx) => ({
    Factory: ctx.createHostConstructor("Factory", () => foreign)
  }));
  expect(
    await second.realm.evaluate(
      "try{new port.Factory();return false;}catch(e){return e instanceof TypeError;}"
    )
  ).toMatchObject({ ok: true, returnValue: true });
  const third = fixture(() => ({ Factory: constructor }));
  await expect(third.realm.evaluate("new port.Factory();")).rejects.toThrow(/Foreign/);
  await first.realm.close();
  expect(
    await second.realm.evaluate(
      "try{new port.Factory();return false;}catch(e){return e instanceof TypeError;}"
    )
  ).toMatchObject({ ok: true, returnValue: true });
});

it("enforces reference quotas, retains constructor graphs, and cleans up on close", async () => {
  const test = fixture(() => ({}), { limit: 1 });
  await test.realm.evaluate("0;");
  const baseline = test.budget.currentDataSize;
  const reference = test.context.createHostConstructor("Factory", () => {
    throw new TypeError();
  });
  expect(test.budget.currentDataSize).toBeGreaterThan(baseline);
  expect(() =>
    test.context.createHostConstructor("Another", () => {
      throw new TypeError();
    })
  ).toThrow(/limit/);
  test.context.releaseGuestReference(reference);
  expect(test.budget.currentDataSize).toBe(baseline);
  test.context.createHostConstructor("Another", () => {
    throw new TypeError();
  });
  await test.realm.close();
  expect(test.budget.currentDataSize).toBe(0);
  expect(() =>
    test.context.createHostConstructor("Closed", () => {
      throw new TypeError();
    })
  ).toThrow(/closed/);
});

it("keeps constructor capabilities out of one-shot run and structured-clone data", async () => {
  let reference!: GuestReference;
  const test = fixture((ctx) => {
    reference = ctx.createHostConstructor("Factory", () => ctx.createHostObject({}));
    return { Factory: reference };
  });
  expect(
    await test.realm.evaluate(
      "try{structuredClone(port.Factory);return false;}catch(e){return true;}"
    )
  ).toMatchObject({ ok: true, returnValue: true });
  await expect(run("return Factory;", { bindings: { Factory: reference } })).rejects.toThrow(
    /capabilit|realm/i
  );
});

it("preserves constructor identity through owned callback export and rejects foreign reimport", async () => {
  let callback: unknown;
  const test = fixture((ctx) => ({
    Factory: ctx.createHostConstructor("Factory", () => ctx.createHostObject({})),
    accept: (value: unknown) => {
      callback = value;
    },
    read: () => callback
  }));
  expect(
    await test.realm.evaluate("port.accept(port.Factory);return port.read()===port.Factory;")
  ).toMatchObject({ ok: true, returnValue: true });
  await expect(test.realm.invokeCallback(callback)).rejects.toThrow(/requires new/);
  const foreign = fixture(() => ({ callback }));
  await expect(foreign.realm.evaluate("port.callback();")).rejects.toThrow(/Foreign/);
});

it("rolls back independently retained callbacks when construction returns an invalid value", async () => {
  let callback: unknown;
  const test = fixture((ctx) => {
    const operation = ctx.retainCallbackArguments((value: unknown) => {
      callback = value;
      return 1 as unknown as HostObject;
    });
    return { Factory: ctx.createHostConstructor("Factory", operation) };
  });
  expect(
    await test.realm.evaluate(
      "try {new port.Factory(() => 42);}catch(e){return e instanceof TypeError;}"
    )
  ).toMatchObject({ ok: true, returnValue: true });
  await expect(test.realm.invokeCallback(callback)).rejects.toThrow(/revoked/);
});

it("enforces constructor graph data quotas and abort revocation", async () => {
  const controller = new AbortController();
  const test = fixture(() => ({}), { signal: controller.signal });
  await test.realm.evaluate("0;");
  controller.abort(new Error("stop constructors"));
  expect(() =>
    test.context.createHostConstructor("Factory", () => {
      throw new Error();
    })
  ).toThrow(/stop constructors/);
  await test.realm.close();
  expect(test.budget.currentDataSize).toBe(0);
  const budget = new Budget({ maxSteps: 100000, dataSize: 20000 });
  const small = fixture(() => ({}), { budget, limit: 1024 });
  await small.realm.evaluate("0;");
  expect(() => {
    for (let index = 0; index < 1024; index++)
      small.context.createHostConstructor("Factory".repeat(100), () => {
        throw new TypeError();
      });
  }).toThrowError(expect.objectContaining({ budget: "dataSize" }));
  await small.realm.close();
  expect(budget.currentDataSize).toBe(0);
});

it("keeps constructor prototype mutations in retained graph accounting", async () => {
  const test = fixture((ctx) => ({
    Factory: ctx.createHostConstructor("Factory", () => ctx.createHostObject({}))
  }));
  await test.realm.evaluate("0;");
  const baseline = test.budget.currentDataSize;
  expect(
    await test.realm.evaluate(
      "port.Factory.prototype.payload=new Array(1024).fill(7);return port.Factory.prototype.payload.length;"
    )
  ).toMatchObject({ ok: true, returnValue: 1024 });
  expect(test.budget.currentDataSize).toBeGreaterThan(baseline + 1024);
  await test.realm.close();
  expect(test.budget.currentDataSize).toBe(0);
});

it("installs native interface inheritance, unforgeable instance checks, tags and constants", async () => {
  const test = fixture((ctx) => {
    const node = ctx.createHostObject({});
    const illegal = () => {
      throw new TypeError("Illegal constructor");
    };
    const Node = ctx.createHostConstructor("Node", illegal, {
      hasInstance: (value) => value === node,
      constants: { ELEMENT_NODE: 1 }
    });
    const Element = ctx.createHostConstructor("Element", illegal, {
      parent: Node,
      hasInstance: (value) => value === node
    });
    return { Node, Element, node };
  });
  expect(
    await test.realm.evaluate(`
    const {Node, Element, node} = port;
    class Child extends Element {}
    let illegal = false;
    try {new Element();}catch(e){illegal = e instanceof TypeError;}
    const constant = Object.getOwnPropertyDescriptor(Node, "ELEMENT_NODE");
    return [node instanceof Node, node instanceof Element, !(node instanceof Child),
      !(Object.create(Element.prototype) instanceof Element), !(new Proxy(node,{}) instanceof Element),
      Object.getPrototypeOf(Element)===Node, Object.getPrototypeOf(Element.prototype)===Node.prototype,
      Element.prototype.constructor===Element, Element.ELEMENT_NODE===1, Element.prototype.ELEMENT_NODE===1,
      !constant.writable && constant.enumerable && !constant.configurable,
      Object.prototype.toString.call(Object.create(Element.prototype)), illegal];
  `)
  ).toMatchObject({
    ok: true,
    returnValue: [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      "[object Element]",
      true
    ]
  });
});

it("validates native interface definitions and never invokes brands for non-host objects", async () => {
  const brand = vi.fn(() => true);
  const test = fixture((ctx) => ({
    Factory: ctx.createHostConstructor("Factory", () => ctx.createHostObject({}), {
      hasInstance: brand
    })
  }));
  expect(
    await test.realm.evaluate(
      "return [{},null,1,() => 1,new Proxy({}, {})].map(value => value instanceof port.Factory);"
    )
  ).toMatchObject({ ok: true, returnValue: [false, false, false, false, false] });
  expect(brand).not.toHaveBeenCalled();
  const illegal = () => {
    throw new TypeError();
  };
  const hook = vi.fn(() => {
    throw new Error("unexpected hook");
  });
  for (const options of [
    { unknown: 1 },
    {
      get hasInstance() {
        return hook();
      }
    },
    {
      constants: {
        get X() {
          return hook();
        }
      }
    },
    { constants: { prototype: 1 } },
    { constants: { X: "1" } },
    { hasInstance: async () => true },
    { parent: {} }
  ])
    expect(() => test.context.createHostConstructor("Bad", illegal, options as never)).toThrow(
      TypeError
    );
  expect(hook).not.toHaveBeenCalled();
});

it("snapshots native constants and rejects foreign or released parent handles", async () => {
  let parent!: GuestReference;
  const constants = { TOKEN: 7 };
  const first = fixture((ctx) => {
    parent = ctx.createHostConstructor("Parent", () => ctx.createHostObject({}), { constants });
    return { Parent: parent };
  });
  await first.realm.evaluate("0;");
  constants.TOKEN = 9;
  expect(await first.realm.evaluate("return port.Parent.TOKEN;")).toMatchObject({
    ok: true,
    returnValue: 7
  });
  const second = fixture(() => ({}));
  await second.realm.evaluate("0;");
  const illegal = () => {
    throw new TypeError();
  };
  expect(() => second.context.createHostConstructor("Child", illegal, { parent })).toThrow(
    /Foreign/
  );
  first.context.releaseGuestReference(parent);
  expect(() => first.context.createHostConstructor("Child", illegal, { parent })).toThrow(
    /revoked/
  );
});

it.each([1, undefined, Promise.resolve(true)])(
  "rejects a non-boolean instance result %#",
  async (result) => {
    const test = fixture((ctx) => {
      const node = ctx.createHostObject({});
      return {
        node,
        Factory: ctx.createHostConstructor("Factory", () => node, {
          hasInstance: (() => result) as () => boolean
        })
      };
    });
    expect(
      await test.realm.evaluate(
        "try{port.node instanceof port.Factory;return 'accepted';}catch(e){return e.name;}"
      )
    ).toMatchObject({ ok: true, returnValue: "TypeError" });
  }
);

it("allows one-shot construction while keeping returned results serializable", async () => {
  const cleanup = vi.fn();
  const extension = defineExtension({
    manifest: { version: 1, name: "one-shot-constructor", globals: ["Factory"] },
    setup(ctx) {
      ctx.onCleanup(cleanup);
      return {
        globals: {
          Factory: ctx.createHostConstructor("Factory", () =>
            ctx.createHostObject({ properties: { value: { get: () => 42 } } })
          )
        }
      };
    }
  });
  const result = await run("return new Factory().value;", { extensions: [extension] });
  expect(result).toMatchObject({ ok: true, returnValue: 42 });
  expect(() => structuredClone(result)).not.toThrow();
  await expect(run("return Factory;", { extensions: [extension] })).rejects.toThrow();
  expect(cleanup).toHaveBeenCalledTimes(2);
});

it("preserves reentry rejection when a constructor tries to evaluate its realm", async () => {
  let nested: Promise<unknown> | undefined;
  const test = fixture((ctx) => ({
    Factory: ctx.createHostConstructor("Factory", () => {
      nested = test.realm.evaluate("globalThis.reentered = true;return 42;");
      void nested.catch(() => undefined);
      return ctx.createHostObject({});
    })
  }));
  expect(await test.realm.evaluate("new port.Factory();")).toMatchObject({ ok: true });
  await expect(nested).rejects.toThrow(/reentry|already running/i);
  expect(await test.realm.evaluate("return typeof globalThis.reentered;")).toMatchObject({
    ok: true,
    returnValue: "undefined"
  });
  await test.realm.close();
  expect(test.budget.currentDataSize).toBe(0);
});
