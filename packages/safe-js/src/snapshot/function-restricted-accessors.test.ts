import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  { change: "", expected: [true, false, "TypeError"] },
  { change: 'Object.defineProperty(Function.prototype,"caller",{value:7});', expected: [true, false, 7] }
])("restores restricted accessor identity and mutations: $change", async ({ change, expected }) => {
  const source = `const prototype=Object.getPrototypeOf(function(){});
    const saved=Object.getOwnPropertyDescriptor(Function.prototype,"arguments").get;
    ${change}await 0;let value;try{value=Function.prototype.caller}catch(e){value=e.name}
    return [saved===Object.getOwnPropertyDescriptor(Function.prototype,"arguments").set,
      Object.isExtensible(saved),value];`.replaceAll("Function.prototype", "prototype");
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
