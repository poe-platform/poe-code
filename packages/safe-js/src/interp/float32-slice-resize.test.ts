import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Float32Array(buffer,4,1);return Array.from(view.slice({valueOf(){buffer.resize(0);return 0}}))",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Float32Array(buffer);view.set([1,2]);return Array.from(view.slice({valueOf(){buffer.resize(4);return 0}}))",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Float32Array(buffer,4,1);return Array.from(view.slice({valueOf(){buffer.resize(0);return 0}},0))",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Float32Array(buffer);view.set([1,2]);return Array.from(view.slice(0,{valueOf(){buffer.resize(4);return 2}}))",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Float32Array(buffer);view.set([1,2]);return Array.from(view.slice({valueOf(){buffer.resize(16);return 0}}))"
])("matches native slice when range conversion resizes the buffer: %s", async body => {
  const source = `try{${body}}catch(error){return {error:error.name}}`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});
