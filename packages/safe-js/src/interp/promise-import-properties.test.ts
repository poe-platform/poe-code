import { admitNativePromiseProperties } from "../index.js";
import { expect, it } from "vitest";
import { deepCopyToSandbox, getPromiseProperties, type SandboxPromise } from "./values.js";

it("imports native promise own string descriptors", () => {
  const value=Promise.resolve(1);
  Object.defineProperty(value,"label",{value:"answer",enumerable:true,configurable:true});
  const imported=deepCopyToSandbox(value) as SandboxPromise;
  expect(Object.getOwnPropertyDescriptor(getPromiseProperties(imported),"label")).toEqual({value:"answer",writable:false,enumerable:true,configurable:true});
});

it("imports explicitly admitted user symbol properties without exposing host promise metadata", () => {
  const key=Symbol("label");const value=Promise.resolve(1);
  Object.defineProperty(value,key,{value:42,enumerable:true});
  admitNativePromiseProperties(value, [key]);
  const properties=getPromiseProperties(deepCopyToSandbox(value) as SandboxPromise);
  expect(properties[key]).toBe(42);
  expect(Reflect.ownKeys(properties)).toEqual([key]);
});
