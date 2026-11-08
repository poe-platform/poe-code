import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  "var let=1;yield let;let=3;return let",
  "var let=1;yield let;let++;return let",
  "var let=0;for(let=0;let<3;let++){}yield let;return let",
  "for(var let of [1,2,3]){}yield let;return let",
  "var let;for(let in {a:1}){}yield let;return let"
])("executes and restores a non-strict let binding: %s", async body => {
  const source = `const C=(function*(){}).constructor;const g=C(${JSON.stringify(body)})();g.next();await 0;return g.next().value`;
  const expected: unknown = await runInNewContext(`(async function(){${source}})()`);
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const saved = JSON.parse(await dump(pending));
    expect(saved.pendingAwaits).toHaveLength(1);
    expect(await completed).toMatchObject({ok: true, returnValue: expected});
    expect(await run(source, {snapshot: restore(saved, {source})})).toMatchObject({ok: true, returnValue: expected});
  } finally { await completed; }
});
