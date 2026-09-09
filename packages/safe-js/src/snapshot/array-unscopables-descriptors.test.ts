import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  { change: "", expected: [true, true, true, true] },
  { change: "saved.values=false;delete saved.find;", expected: [true, false, false, true] },
  { change: "delete Array.prototype[Symbol.unscopables];", expected: [false, true, true, true] }
])("recovers unscopables records independently of dynamic source: $change", async ({ change, expected }) => {
  const source = `const saved=Array.prototype[Symbol.unscopables];${change}await 0;
    return [saved===Array.prototype[Symbol.unscopables],saved.values,
      'find' in saved,Object.getPrototypeOf(saved)===null];`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const snapshot = JSON.parse(await dump(pending));
    expect(await completed).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot: restore(snapshot, { source }) })).toMatchObject({
      ok: true, returnValue: expected
    });
  } finally {
    await completed;
  }
});
