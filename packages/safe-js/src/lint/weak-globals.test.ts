import { expect, it } from "vitest";
import { lint } from "./index.js";
import { run } from "../run.js";

it.each([
  ["WeakMap", "const key={};return new WeakMap([[key,7]]).get(key)", 7],
  ["WeakSet", "const key={};return new WeakSet([key]).has(key)", true],
  ["WeakRef", "const target={};return new WeakRef(target).deref()===target", true],
  ["FinalizationRegistry", "const registry=new FinalizationRegistry(()=>{});const token={};registry.register({},7,token);return registry.unregister(token)", true]
] as const)("accepts implemented %s behavior in harness source", async (_name, source, value) => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:value});
  expect(lint(source)).toEqual([]);
});

it.each(["WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry"])("warns about local %s shadowing", name => {
  expect(lint(`const ${name}=1;return ${name}`)).toEqual([
    expect.objectContaining({code:"AS-SHADOW-GLOBAL",severity:"warning"})
  ]);
});

it("still rejects an unknown weak-reference constructor", () => {
  expect(lint("return new WeakReference({})")).toContainEqual(
    expect.objectContaining({code:"AS003"})
  );
});
