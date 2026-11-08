import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  'return Promise.prototype[Symbol.toStringTag]',
  'return Object.getOwnPropertyDescriptor(Promise.prototype,Symbol.toStringTag)',
  'return [Object.prototype.toString.call(Promise.prototype),Object.prototype.toString.call(Promise.resolve(1))]',
  'delete Promise.prototype[Symbol.toStringTag];return Object.prototype.toString.call(Promise.resolve(1))',
  'Object.defineProperty(Promise.prototype,Symbol.toStringTag,{value:"Changed"});return Object.prototype.toString.call(Promise.resolve(1))',
  'Object.defineProperty(Promise.prototype,Symbol.toStringTag,{value:7});return Object.prototype.toString.call(Promise.resolve(1))',
  'const object=Object.create(Promise.prototype);return Object.prototype.toString.call(object)'
])("matches native Promise toStringTag: %s", source => {
  return expect(run(source)).resolves.toMatchObject({
    ok: true, returnValue: runInNewContext(`(function(){${source}})()`)
  });
});
