import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { Worker } from "node:worker_threads";
import * as native from "../dist/index.js";
import * as reference from "toolcraft-schema";

test("host graph utilities are available independently of the JSON compiler", () => {
  assert.equal(typeof native.cloneDefaultValue, "function");
  assert.equal(typeof native.isJsonValue, "function");
});

test("JSON admission matches host types, resource objects, holes and shared graphs", () => {
  const shared = { a: [1, "\ud800", true, null] };
  const cycle = {};
  cycle.self = cycle;
  for (const value of [
    null,
    true,
    false,
    "",
    "\ud800",
    -0,
    2,
    NaN,
    Infinity,
    -Infinity,
    undefined,
    1n,
    Symbol("x"),
    () => 1,
    [],
    {},
    Object.create(null),
    new Date(),
    new Map(),
    new Set(),
    new Uint8Array(2),
    /x/,
    Object(1),
    Object("x"),
    Object.create({ x: 1 }),
    new Array(2),
    [undefined],
    [null],
    cycle,
    { a: shared, b: shared },
    vm.runInNewContext("({x: 1})"),
    vm.runInNewContext("[1, 2]"),
    Object.assign([], { ignored: () => 1 }),
    Object.defineProperty({}, "ignored", { value: () => 1 }),
    { [Symbol("ignored")]: () => 1 },
    Object.defineProperty({}, "__proto__", { value: 1, enumerable: true })
  ])
    assert.equal(native.isJsonValue(value), reference.isJsonValue(value));
});

test("JSON admission rejects accessors and serialization hooks without evaluating them", () => {
  let effects = 0;
  const getter = () => {
    effects++;
    return 1;
  };
  for (const value of [
    Object.defineProperty({}, "x", { get: getter, enumerable: true }),
    Object.defineProperty([1], "0", { get: getter }),
    { toJSON: getter },
    Object.defineProperty({}, "toJSON", { get: getter }),
    Object.setPrototypeOf([], { toJSON: getter })
  ]) {
    assert.equal(native.isJsonValue(value), false);
    assert.equal(reference.isJsonValue(value), false);
  }
  assert.equal(effects, 0);
  assert.equal(native.isJsonValue({ toJSON: "ordinary" }), true);
});

test("JSON budgets count descendants, repeated references, and depth exactly", () => {
  const shared = [1, 2];
  for (const value of [null, [], {}, [1], [[1]], { a: shared, b: shared }]) {
    for (const maxNodes of [1, 2, 3, 4, 5, 7, Infinity]) {
      for (const maxDepth of [0, 1, 2, Infinity]) {
        const options = { maxNodes, maxDepth };
        assert.equal(native.isJsonValue(value, options), reference.isJsonValue(value, options));
      }
    }
  }
  let deep = 1;
  for (let i = 0; i < 65; i++) deep = { child: deep };
  assert.equal(native.isJsonValue(deep), false);
  assert.equal(native.isJsonValue(deep, { maxDepth: Infinity }), true);
  assert.equal(native.isJsonValue(new Array(10001).fill(0)), false);
});

test("JSON limit validation preserves messages and option access order", () => {
  for (const name of ["maxNodes", "maxDepth"]) {
    for (const value of [-1, -Infinity, NaN, 0.5, 2 ** 53, "1", true, 1n, {}, Symbol()]) {
      const options = { [name]: value };
      assert.throws(() => native.isJsonValue(null, options), {
        message:
          name === "maxNodes"
            ? "maxNodes must be a positive safe integer"
            : "maxDepth must be a nonnegative safe integer or Infinity"
      });
    }
    for (const value of [null, undefined, Infinity]) {
      assert.equal(native.isJsonValue(null, { [name]: value }), true);
    }
  }
  assert.throws(() => native.isJsonValue(null, { maxNodes: 0 }));
  assert.equal(native.isJsonValue(null, { maxDepth: 0 }), true);
  for (const implementation of [native, reference]) {
    const log = [];
    assert.throws(() =>
      implementation.isJsonValue(null, {
        get maxNodes() {
          log.push("nodes");
          return -1;
        },
        get maxDepth() {
          log.push("depth");
          return -1;
        }
      })
    );
    assert.deepEqual(log, ["nodes", "depth"]);
  }
});

test("default cloning isolates containers and preserves aliases, cycles and opaque identities", () => {
  const shared = { data: [] };
  const callback = () => 42;
  const resource = new WeakMap();
  const source = Object.assign(Object.create(null), {
    first: shared,
    second: shared,
    callback,
    resource,
    sparse: new Array(3)
  });
  shared.parent = source;
  source.sparse[1] = shared;
  Object.defineProperty(source, "__proto__", { value: shared, enumerable: true });
  source[Symbol("ignored")] = 1;
  Object.defineProperty(source, "hidden", { value: 2 });
  const result = native.cloneDefaultValue(source);
  assert.notEqual(result, source);
  assert.equal(Object.getPrototypeOf(result), null);
  assert.notEqual(result.first, shared);
  assert.equal(result.first, result.second);
  assert.equal(result.first.parent, result);
  assert.equal(result.__proto__, result.first);
  assert.equal(result.callback, callback);
  assert.equal(result.resource, resource);
  assert.equal(result.sparse[1], result.first);
  assert.equal(result.sparse.length, 3);
  assert.equal(0 in result.sparse, false);
  assert.deepEqual(Object.getOwnPropertySymbols(result), []);
  assert.equal(Object.hasOwn(result, "hidden"), false);
  assert.deepEqual(Object.getOwnPropertyDescriptor(result, "__proto__"), {
    value: result.first,
    enumerable: true,
    configurable: true,
    writable: true
  });
});

test("default cloning reads getters once in depth-first order with snapshotted keys", () => {
  function run(implementation) {
    const log = [];
    const source = {
      get first() {
        log.push("first");
        return {
          get child() {
            log.push("child");
            delete source.last;
            source.extra = 1;
            return 2;
          }
        };
      },
      get second() {
        log.push("second");
        return 3;
      },
      last: 4
    };
    return { value: implementation.cloneDefaultValue(source), log };
  }
  assert.deepEqual(run(native), run(reference));
});

test("host operations preserve arbitrary throws and support reentrant calls", () => {
  for (const thrown of [undefined, null, 1, "failure", Symbol(), {}, new Error("failure")]) {
    for (const implementation of [native, reference]) {
      const source = Object.defineProperty({}, "x", {
        enumerable: true,
        get() {
          throw thrown;
        }
      });
      let caught = false;
      try {
        implementation.cloneDefaultValue(source);
      } catch (error) {
        caught = true;
        assert.equal(error, thrown);
      }
      assert.equal(caught, true);
      const proxy = new Proxy(
        {},
        {
          getPrototypeOf() {
            throw thrown;
          }
        }
      );
      caught = false;
      try {
        implementation.isJsonValue(proxy);
      } catch (error) {
        caught = true;
        assert.equal(error, thrown);
      }
      assert.equal(caught, true);
    }
  }
  const result = native.cloneDefaultValue({
    get nested() {
      return native.cloneDefaultValue({ valid: native.isJsonValue([1]) });
    }
  });
  assert.deepEqual(result, { nested: { valid: true } });
});

test("proxy enumeration and prototype access traces match the reference", () => {
  function run(implementation, operation) {
    const log = [];
    const proxy = new Proxy(
      { a: { b: 1 }, c: 2 },
      {
        getPrototypeOf(target) {
          log.push("prototype");
          return Reflect.getPrototypeOf(target);
        },
        ownKeys(target) {
          log.push("keys");
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, key) {
          log.push(["descriptor", key]);
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
        get(target, key, receiver) {
          log.push(["get", key]);
          return Reflect.get(target, key, receiver);
        }
      }
    );
    return { result: implementation[operation](proxy), log };
  }
  for (const operation of ["cloneDefaultValue", "isJsonValue"]) {
    assert.deepEqual(run(native, operation), run(reference, operation));
  }
});

test("deep host graphs do not consume the native call stack", () => {
  let source = { leaf: 1 };
  for (let index = 0; index < 12000; index++) source = { child: source };
  assert.equal(native.isJsonValue(source, { maxNodes: Infinity, maxDepth: Infinity }), true);
  let result = native.cloneDefaultValue(source);
  for (let index = 0; index < 12000; index++) {
    assert.notEqual(result, source);
    result = result.child;
    source = source.child;
  }
  assert.deepEqual(result, { leaf: 1 });
});

test("serialization-hook prototype traversal has the same fixed boundary", () => {
  for (const depth of [62, 63, 64, 65]) {
    let prototype = null;
    for (let index = 0; index < depth; index++) prototype = Object.create(prototype);
    const value = Object.setPrototypeOf([], prototype);
    assert.equal(native.isJsonValue(value), reference.isJsonValue(value));
    assert.equal(native.isJsonValue(value), depth < 64);
  }
  let cyclic;
  cyclic = new Proxy([], { getPrototypeOf: () => cyclic });
  assert.equal(native.isJsonValue(cyclic), false);
  assert.equal(reference.isJsonValue(cyclic), false);
});

test("changing array and null-prototype proxy traps preserve ordering", () => {
  function run(implementation, operation, array) {
    const log = [];
    let prototypeReads = 0;
    const target = array ? [1, 2, 3] : Object.assign(Object.create(null), { a: 1 });
    const value = new Proxy(target, {
      getPrototypeOf(target) {
        log.push(["prototype", ++prototypeReads]);
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        log.push("keys");
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        log.push(["descriptor", key]);
        if (array && key === "0") target.length = 2;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      get(target, key, receiver) {
        log.push(["get", key]);
        return Reflect.get(target, key, receiver);
      }
    });
    return { result: implementation[operation](value), log };
  }
  for (const operation of ["isJsonValue", "cloneDefaultValue"]) {
    for (const array of [false, true]) {
      assert.deepEqual(run(native, operation, array), run(reference, operation, array));
    }
  }
});

test("cloning retains primitive and cross-realm resource identity", () => {
  for (const value of [
    undefined,
    null,
    true,
    1n,
    Symbol(),
    -0,
    NaN,
    "\ud800",
    () => 1,
    vm.runInNewContext("({a: 1})"),
    new Date(),
    /x/,
    new Uint8Array(1)
  ])
    assert.equal(native.cloneDefaultValue(value), value);
  const array = vm.runInNewContext("[1, {a: 2}]");
  const cloned = native.cloneDefaultValue(array);
  assert.notEqual(cloned, array);
  assert.equal(Object.getPrototypeOf(cloned), Array.prototype);
  assert.equal(cloned[1], array[1]);
});

test("graph state stays isolated between Node worker environments", async () => {
  const module = new URL("../dist/index.js", import.meta.url).href;
  await Promise.all(
    [1, 2].map(
      (seed) =>
        new Promise((resolve, reject) => {
          let message;
          const worker = new Worker(
            "const { parentPort, workerData } = require('node:worker_threads');" +
              "import(workerData.module).then(({ cloneDefaultValue, isJsonValue }) => {" +
              "const source = { seed: workerData.seed }; source.self = source;" +
              "const clone = cloneDefaultValue(source);" +
              "parentPort.postMessage([clone !== source, clone.self === clone, clone.seed, isJsonValue(clone)]);" +
              "});",
            { eval: true, workerData: { module, seed } }
          );
          worker.once("message", (value) => {
            message = value;
          });
          worker.once("error", reject);
          worker.once("exit", (code) => {
            try {
              assert.equal(code, 0);
              assert.deepEqual(message, [true, true, seed, false]);
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        })
    )
  );
});
