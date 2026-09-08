import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  ["Map.prototype", "new Map()"],
  ["Set.prototype", "new Set()"],
  ["Object.getPrototypeOf(Uint8Array.prototype)", "new Uint8Array(1)"]
])("restores deleted %s tags", async (owner, expression) => {
  const source = `const value=${expression};delete ${owner}[Symbol.toStringTag];await 0;
    return Object.prototype.toString.call(value);`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const snapshot = JSON.parse(await dump(pending));
    const expected = { ok: true, returnValue: "[object Object]" };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot: restore(snapshot, { source }) })).toMatchObject(expected);
  } finally { await completed; }
});
