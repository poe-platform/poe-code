import {expect, it} from "vitest";
import {Scope} from "../interp/scope.js";
import {createModuleNamespace} from "../interp/module-namespace.js";

it("reads a live namespace without changing namespace descriptors", () => {
  let value = 1;
  const ns = createModuleNamespace({value: undefined}, key => key === "value" ? value : undefined);
  expect(ns.value).toBe(1);
  value = 2;
  expect(Object.getOwnPropertyDescriptor(ns,"value")).toEqual({value:2,writable:true,enumerable:true,configurable:false});
  expect(Reflect.set(ns,"value",3)).toBe(false);
  expect(Reflect.defineProperty(ns,"value",{value:2})).toBe(true);
  expect(Reflect.defineProperty(ns,"value",{value:1})).toBe(false);
  expect(Object.getPrototypeOf(ns)).toBe(null);
  expect(Object.isExtensible(ns)).toBe(false);
});

it("retains the exporting cell and import immutability", () => {
  const exporter = new Scope();
  exporter.predeclare("value","let");
  const importer = new Scope();
  importer.declareImport("local",exporter,"value");
  expect(() => importer.lookup("local")).toThrow(ReferenceError);
  exporter.declare("value","let",1);
  expect(importer.lookup("local")).toMatchObject({value:1,kind:"const"});
  exporter.assign("value",2);
  expect(importer.lookup("local")).toMatchObject({value:2});
  expect(() => importer.assign("local",3)).toThrow(TypeError);
  expect(exporter.lookup("value")).toMatchObject({value:2});
});
