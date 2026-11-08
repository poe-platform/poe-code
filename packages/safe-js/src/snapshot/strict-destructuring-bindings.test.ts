import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  { assignment: "[value=(yield 1,delete globalThis.value,7)]=[]", expected: ["ReferenceError", false] },
  { assignment: "({value=(yield 1,delete globalThis.value,7)}={})", expected: ["ReferenceError", false] },
  { assignment: "[globalThis.value=(yield 1,delete globalThis.value,7)]=[]", expected: ["assigned", 7] },
  { assignment: "({value:globalThis.value=(yield 1,delete globalThis.value,7)}={})", expected: ["assigned", 7] }
])("restores strict destructuring references: $assignment", async ({ assignment, expected }) => {
  const body = `"use strict";globalThis.value=1;try{${assignment}}catch(error){return [error.name,Object.hasOwn(globalThis,'value')]}return ['assigned',globalThis.value]`;
  const source = `const C=(function*(){}).constructor;const iterator=C(${JSON.stringify(body)})();iterator.next();await 0;return iterator.next(2).value`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const saved = JSON.parse(await dump(pending));
    expect(await completed).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot: restore(saved, { source }) }))
      .toMatchObject({ ok: true, returnValue: expected });
  } finally { await completed; }
});
