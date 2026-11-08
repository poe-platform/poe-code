import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

// ECMA-262 2026, 23.1.3.41. Older supported hosts have an older list/order.
const unscopableNames = [
  "at", "copyWithin", "entries", "fill", "find", "findIndex", "findLast",
  "findLastIndex", "flat", "flatMap", "includes", "keys", "toReversed",
  "toSorted", "toSpliced", "values"
];

it.each([
  { source: "return Object.entries(Array.prototype[Symbol.unscopables])",
    expected: unscopableNames.map(name => [name, true]) },
  { source: "return Object.entries(Object.getOwnPropertyDescriptors(Array.prototype[Symbol.unscopables])).map(([key,d])=>[key,d.value,d.writable,d.enumerable,d.configurable])",
    expected: unscopableNames.map(name => [name, true, true, true, true]) }
])("exposes the specified unscopables record: $source", ({ source, expected }) => {
  return expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
});

it.each([
  "return Object.getPrototypeOf(Array.prototype[Symbol.unscopables])===null",
  "const d=Object.getOwnPropertyDescriptor(Array.prototype,Symbol.unscopables);return [d.writable,d.enumerable,d.configurable]",
  "const saved=Array.prototype[Symbol.unscopables];saved.values=false;delete saved.find;return [saved===Array.prototype[Symbol.unscopables],saved.values,'find' in saved]",
  "const saved=Array.prototype[Symbol.unscopables];Object.defineProperty(Array.prototype,Symbol.unscopables,{value:{custom:true}});return [saved===Array.prototype[Symbol.unscopables],Array.prototype[Symbol.unscopables].custom]",
  "return delete Array.prototype[Symbol.unscopables]"
])("matches native unscopables descriptors without dynamic source: %s", source => {
  return expect(run(source)).resolves.toMatchObject({
    ok: true,
    returnValue: runInNewContext(`(function(){${source}})()`)
  });
});
