import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  ["Map.prototype", "new Map()"],
  ["Set.prototype", "new Set()"],
  ["Object.getPrototypeOf(Uint8Array.prototype)", "new Uint8Array(1)"],
  ["Object.getPrototypeOf(Float32Array.prototype)", "new Float32Array(1)"]
])("uses the native fallback after deleting %s's tag", (owner, expression) => {
  const source = `delete ${owner}[Symbol.toStringTag];return Object.prototype.toString.call(${expression})`;
  return expect(run(source)).resolves.toMatchObject({
    ok: true, returnValue: runInNewContext(`(function(){${source}})()`)
  });
});

it.each(["new Map()", "new Set()", "new Uint8Array(1)", "new Float32Array(1)"])(
  "preserves the installed tag for %s", expression => {
    const source = `return Object.prototype.toString.call(${expression})`;
    return expect(run(source)).resolves.toMatchObject({
      ok: true, returnValue: runInNewContext(`(function(){${source}})()`)
    });
  }
);
