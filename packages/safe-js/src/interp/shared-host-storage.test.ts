import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { cloneSharedArrayBufferStorage, createSharedArrayBufferStorage } from "./shared-array-buffer.js";
import { restoreDataView } from "./data-view.js";
import { restoreSharedHostValue } from "./shared-host-storage.js";

it("rebinds an older image without overwriting newer bytes or growth", () => {
  const source=createSharedArrayBufferStorage(4,8,new Budget());
  const target=createSharedArrayBufferStorage(8,8,new Budget());
  new Uint8Array(source)[0]=1;
  new Uint8Array(target)[0]=2;
  const result=restoreSharedHostValue(source,[{source,target,write:false}]) as SharedArrayBuffer;
  expect(result.byteLength).toBe(8);
  expect(new Uint8Array(result)[0]).toBe(2);
  new Uint8Array(result)[7]=9;
  expect(new Uint8Array(target)[7]).toBe(9);
});

it("reconnects distinct outcome wrappers and views to an existing shared block", () => {
  const source=createSharedArrayBufferStorage(4,8,new Budget());
  const alias=cloneSharedArrayBufferStorage(source);
  const target=createSharedArrayBufferStorage(2,8,new Budget());
  new Uint8Array(source)[0]=7;
  const view=restoreDataView(alias,0);
  const result=restoreSharedHostValue([source,alias,view],[{source,target}]);
  if (!Array.isArray(result)) throw new Error("Missing restored values");
  const [a,b,d]=result as [SharedArrayBuffer,SharedArrayBuffer,DataView];
  expect(a).not.toBe(b);
  expect(a).not.toBe(target);
  expect(d.buffer).toBe(b);
  expect(target.byteLength).toBe(4);
  expect(new Uint8Array(target)[0]).toBe(7);
  d.setUint8(0,9);
  expect(new Uint8Array(target)[0]).toBe(9);
  expect(new Uint8Array(source)[0]).toBe(7);
});

it("validates all shared bindings before changing any target", () => {
  const first=createSharedArrayBufferStorage(4,8,new Budget());
  const second=createSharedArrayBufferStorage(4,8,new Budget());
  const target=createSharedArrayBufferStorage(2,8,new Budget());
  const invalid=createSharedArrayBufferStorage(4,16,new Budget());
  new Uint8Array(first)[0]=7;
  expect(()=>restoreSharedHostValue([first,second],[{source:first,target},{source:second,target:invalid}]))
    .toThrow(TypeError);
  expect(target.byteLength).toBe(2);
  expect(new Uint8Array(target)[0]).toBe(0);
});

it("rejects merging independent outcome blocks onto one argument block", () => {
  const first=createSharedArrayBufferStorage(4,undefined,new Budget());
  const second=createSharedArrayBufferStorage(4,undefined,new Budget());
  const target=createSharedArrayBufferStorage(4,undefined,new Budget());
  expect(()=>restoreSharedHostValue([first,second],[{source:first,target},{source:second,target}]))
    .toThrow(TypeError);
});

it("does not mutate shared targets when the result graph cannot be copied", () => {
  const source=createSharedArrayBufferStorage(4,undefined,new Budget());
  const target=createSharedArrayBufferStorage(4,undefined,new Budget());
  new Uint8Array(source)[0]=7;
  const invalid={source,get bad(){throw new Error("Must not execute accessor");}};
  expect(()=>restoreSharedHostValue(invalid,[{source,target}])).toThrow();
  expect(new Uint8Array(target)[0]).toBe(0);
});
