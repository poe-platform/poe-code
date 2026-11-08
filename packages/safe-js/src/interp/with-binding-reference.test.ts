import { expect, it, vi } from "vitest";
import { Scope } from "./scope.js";

const operations = {
  has: (object: object, name: string) => Reflect.has(object, name),
  get: async (object: object, key: PropertyKey) => Reflect.get(object, key)
};

it("resolves lexical-only scope chains without allocating an asynchronous result", () => {
  const parent = new Scope();
  parent.declare("x", "let", 1);
  const scope = parent.child().child();
  expect(scope.resolveBinding("x", operations)).toEqual({kind: "binding", name: "x", scope: parent});
});

it("resolves inherited object bindings without reading their value", async () => {
  const read = vi.fn(() => 7);
  const object = Object.create({get x(){return read();}});
  const scope = new Scope().withObject(object);
  expect(await scope.resolveBinding("x", operations)).toEqual({kind: "object", name: "x", object, withEnvironment: true});
  expect(read).not.toHaveBeenCalled();
});

it("awaits guest unscopables access and falls back to the lexical parent", async () => {
  const parent = new Scope();
  parent.declare("x", "let", 1);
  const object = {x: 2};
  const get = vi.fn(async (_object: object, key: PropertyKey) => key === Symbol.unscopables ? {x: true} : true);
  expect(await parent.withObject(object).resolveBinding("x", {...operations, get}))
    .toEqual({kind: "binding", name: "x", scope: parent});
  expect(get.mock.calls.map(call => call[1])).toEqual([Symbol.unscopables, "x"]);
});

it("does not inspect unscopables for a name absent from the object", async () => {
  const get = vi.fn(operations.get);
  const scope = new Scope().withObject({});
  expect(await scope.resolveBinding("missing", {...operations, get})).toEqual({kind: "unresolvable", name: "missing"});
  expect(get).not.toHaveBeenCalled();
});

it("resolves lexical shadowing before consulting the with environment", async () => {
  const scope = new Scope().withObject({x: 2}).child();
  scope.declare("x", "let", 3);
  const has = vi.fn(operations.has);
  expect(await scope.resolveBinding("x", {...operations, has})).toEqual({kind: "binding", name: "x", scope});
  expect(has).not.toHaveBeenCalled();
});

it("retains the resolved object base after its property is deleted", async () => {
  const object: {x?: number} = {x: 1};
  const reference = await new Scope().withObject(object).resolveBinding("x", operations);
  delete object.x;
  expect(reference).toEqual({kind: "object", name: "x", object, withEnvironment: true});
});

it("retains the with object as a data-accounting root", () => {
  const object = {payload: "x".repeat(4096)};
  const scope = new Scope().withObject(object).child();
  expect(scope.retainedDataRoots()).toContain(object);
});
