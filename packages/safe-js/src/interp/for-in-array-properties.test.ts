import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  'const a=[10];a.label=20;const keys=[];for(const key in a)keys.push(key);return keys',
  'const a=[];a["4294967295"]=1;a["01"]=2;a["-1"]=3;const keys=[];for(const key in a)keys.push(key);return keys',
  'const parent=[];parent.label=1;const child=Object.create(parent);child.own=2;const keys=[];for(const key in child)keys.push(key);return keys',
  'const a=[10];a.visible=20;Object.defineProperty(a,"hidden",{value:30});a[Symbol("private")]=40;const keys=[];for(const key in a)keys.push(key);return keys',
  'const a=[10];a.extra=20;const keys=[];for(const key in a){keys.push(key);delete a.extra}return keys',
  'const parent=[];parent.label=1;const child=Object.create(parent);Object.defineProperty(child,"label",{value:2});const keys=[];for(const key in child)keys.push(key);return keys'
])("enumerates array string properties in for-in: %s", async source => {
  expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
});
