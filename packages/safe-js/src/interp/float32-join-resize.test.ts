import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Float32Array(buffer);return view.join({toString(){buffer.resize(0);return '-'}})",
  "const buffer=new ArrayBuffer(12,{maxByteLength:16});const view=new Float32Array(buffer,4,2);return view.join({toString(){buffer.resize(4);return '-'}})",
  "const buffer=new ArrayBuffer(12,{maxByteLength:16});const view=new Float32Array(buffer);view.set([1,2,3]);return view.join({toString(){buffer.resize(4);return '-'}})",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Float32Array(buffer);view.set([1,2]);return view.join({toString(){buffer.resize(16);return '-'}})",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Float32Array(buffer);return view.join({toString(){buffer.resize(0);buffer.resize(8);return '-'}})"
])("matches native join when separator conversion resizes the buffer: %s", async source => {
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});
