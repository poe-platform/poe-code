import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([false, true])("recovers the recreated eval variable with outer binding=%s", async outer => {
  const body = `${outer ? "globalThis.f=9;" : ""}eval("delete f;{function f(){return 7}}");return ()=>[f(),typeof globalThis.f,delete f,typeof f]`;
  const source = `const later=Function(${JSON.stringify(body)})();await 0;return later()`;
  const expected = [7, outer ? "number" : "undefined", true, outer ? "number" : "undefined"];
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
