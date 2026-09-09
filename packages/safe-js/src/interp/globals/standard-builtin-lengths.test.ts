import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

const lengths = {
  "Object.assign": 2, "Object.getOwnPropertyDescriptor": 2,
  "Object.getOwnPropertyDescriptors": 1, "Object.getOwnPropertyNames": 1,
  "Object.getOwnPropertySymbols": 1, "Object.hasOwn": 2, "Object.is": 2,
  "Object.preventExtensions": 1, "Object.seal": 1, "Object.create": 2,
  "Object.defineProperties": 2, "Object.defineProperty": 3, "Object.freeze": 1,
  "Object.getPrototypeOf": 1, "Object.setPrototypeOf": 2,
  "Object.isExtensible": 1, "Object.isFrozen": 1, "Object.isSealed": 1,
  "Object.keys": 1, "Object.entries": 1, "Object.fromEntries": 1, "Object.values": 1,
  "Array.isArray": 1, "Array.from": 1,
  "String.raw": 1, "String.fromCharCode": 1, "String.fromCodePoint": 1,
  "Number.isFinite": 1, "Number.isInteger": 1, "Number.isNaN": 1,
  "Number.isSafeInteger": 1, "BigInt.prototype.toString": 0
};

describe.each(Object.entries(lengths))("%s function length", (path, length) => {
  it("matches the standard descriptor and bound lengths before and after replay", async () => {
    const source = `await 0;const fn=${path};return [Object.getOwnPropertyDescriptor(fn,'length'),fn.bind(null).length,fn.bind(null,0).length,fn.bind(null,0,0,0).length]`;
    const expected = [
      { value: length, writable: false, enumerable: false, configurable: true },
      length, Math.max(0, length - 1), 0
    ];
    expect(await runInNewContext(`(async()=>{${source}})()`, {}, { timeout: 1000 }))
      .toEqual(expected);
    const result = await run(source);
    expect(result).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot: JSON.parse(await dump(result)) }))
      .toMatchObject({ ok: true, returnValue: expected });
  });
});
