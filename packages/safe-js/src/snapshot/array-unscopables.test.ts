import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  { change: "", expected: [true, "number"] },
  { change: "saved.values=false;", expected: [true, "function"] },
  { change: "delete Array.prototype[Symbol.unscopables];", expected: [false, "function"] }
])("restores array unscopables identity and behavior: $change", async ({ change, expected }) => {
  const body = "const values=7;with([]){return typeof values}";
  const source = `const saved=Array.prototype[Symbol.unscopables];${change}await 0;
    return [saved===Array.prototype[Symbol.unscopables],Function(${JSON.stringify(body)})()];`;
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
