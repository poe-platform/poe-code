import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "return Object.entries(Array.prototype[Symbol.unscopables])",
  "return Object.getPrototypeOf(Array.prototype[Symbol.unscopables])===null",
  "const d=Object.getOwnPropertyDescriptor(Array.prototype,Symbol.unscopables);return [d.writable,d.enumerable,d.configurable,Object.keys(d.value)]",
  "const values=7,find=8,at=9;with([]){return [values,find,at]}",
  "const values=7;Array.prototype[Symbol.unscopables].values=false;with([]){return typeof values}",
  "const values=7;delete Array.prototype[Symbol.unscopables];with([]){return typeof values}"
])("matches native array unscopables: %s", body => {
  // Use a fresh native realm so mutation cases cannot alter another control.
  const source = `return Function(${JSON.stringify(body)})()`;
  return expect(run(source)).resolves.toMatchObject({
    ok: true, returnValue: runInNewContext(`(function(){${source}})()`)
  });
});
