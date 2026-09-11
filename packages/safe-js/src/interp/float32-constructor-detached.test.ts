import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

const cases = [
  'buffer.transfer();new Float32Array(buffer,4)',
  'buffer.transfer();new Float32Array(buffer,0,1)',
  'buffer.transfer();new Float32Array(buffer,4,0)',
  'new Float32Array(buffer,{valueOf(){events.push("offset");buffer.transfer();return 4}})',
  'new Float32Array(buffer,0,{valueOf(){events.push("length");buffer.transfer();return 1}})',
  'buffer.transfer();new Float32Array(buffer,0,{valueOf(){events.push("length");return 1}})',
  'buffer.transfer();new Float32Array(buffer,0,{valueOf(){events.push("length");return -1}})',
  'buffer.transfer();new Float32Array(buffer,1,{valueOf(){events.push("length");return 0}})',
  'buffer.transfer();new Float32Array(buffer,0,{valueOf(){events.push("length");throw new SyntaxError("sentinel")}})',
  'buffer.transfer();new Float32Array(buffer,0,0)',
  'new Float32Array(buffer,12)',
  'new Float32Array(buffer,0,3)'
];

it.each(cases.flatMap(operation => [false,true].map(resizable => ({operation,resizable}))))(
  "matches native constructor validation order: $operation (resizable=$resizable)", async ({operation,resizable}) => {
  const source = `const buffer=new ArrayBuffer(8,${resizable?"{maxByteLength:16}":"undefined"});const events=[];let error;try{${operation}}catch(caught){error=caught.name}return [error,events,buffer.detached]`;
  const expected = runInNewContext(`(function(){${source}})()`);
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});

it.each([0,4,16])("reads resized storage after length coercion (%s bytes)", async bytes => {
  const source = `const buffer=new ArrayBuffer(8,{maxByteLength:16});let result;try{result=new Float32Array(buffer,4,{valueOf(){buffer.resize(${bytes});return 1}}).length}catch(error){result=error.name}return [result,buffer.byteLength]`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});
