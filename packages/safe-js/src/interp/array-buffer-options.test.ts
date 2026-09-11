import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});return [buffer.byteLength,buffer.maxByteLength,buffer.resizable]",
  "const buffer=new ArrayBuffer(8);return [buffer.byteLength,buffer.maxByteLength,buffer.resizable]",
  "const trace=[];const buffer=new ArrayBuffer({valueOf(){trace.push('length');return 8}},{get maxByteLength(){trace.push('option');return {valueOf(){trace.push('max');return 16}}}});return [buffer.byteLength,buffer.maxByteLength,trace]",
  "return [4,-1,Infinity,Symbol('x'),BigInt(8)].map(maxByteLength=>{try{new ArrayBuffer(8,{maxByteLength});return 'accepted'}catch(error){return error.name}})",
  "const trace=[];new ArrayBuffer({valueOf(){trace.push('length');return 8}},{get maxByteLength(){trace.push('option');return undefined}});return trace",
  "const trace=[];try{new ArrayBuffer(8,{get maxByteLength(){trace.push('option');throw 7}})}catch(error){return [error,trace]}",
  "const trace=[];const buffer=new ArrayBuffer(8);try{new Float32Array(buffer,{valueOf(){trace.push('offset');return 16}},{valueOf(){trace.push('length');return 1}})}catch(error){return [error.name,trace]}"
])("matches native buffer option and offset order: %s", async source => {
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});
