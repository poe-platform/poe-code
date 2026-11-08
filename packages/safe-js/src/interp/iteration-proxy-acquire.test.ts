import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  'const source=new Proxy({*[Symbol.iterator](){yield 3;yield 5}},{});return [...source]',
  'const source=Object.create(new Proxy({*[Symbol.iterator](){yield 3;yield 5}},{}));return Array.from(source)',
  'const source=new Proxy({},{get(t,k){if(k===Symbol.iterator)return function*(){yield 3;yield 5}}});return [...source]',
  'const source=new Proxy({*[Symbol.iterator](){yield 3;yield 5}},{});const out=[];for await(const value of source)out.push(value);return out',
  'const source=new Proxy({async *[Symbol.asyncIterator](){yield 3;yield 5}},{});const out=[];for await(const value of source)out.push(value);return out'
])("acquires observable Proxy iterator methods: %s", async source => {
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  const native = await new AsyncFunction(source)();
  expect(native).toEqual([3,5]);
  expect((await run(source)).returnValue).toEqual(native);
});
