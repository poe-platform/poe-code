import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  { change: "", expected: "[object Promise]" },
  { change: "delete Promise.prototype[Symbol.toStringTag];", expected: "[object Object]" },
  { change: 'Object.defineProperty(Promise.prototype,Symbol.toStringTag,{value:"Changed"});', expected: "[object Changed]" }
])("restores Promise tag changes: $change", async ({ change, expected }) => {
  const source = `const promise=Promise.resolve(1);${change}await 0;
    return Object.prototype.toString.call(promise);`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const snapshot = JSON.parse(await dump(pending));
    expect(await completed).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot: restore(snapshot, { source }) })).toMatchObject({
      ok: true, returnValue: expected
    });
  } finally { await completed; }
});
