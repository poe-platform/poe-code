import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  "label:function f(){return 3}yield 0;return f()",
  "{label:function f(){return 3}}yield 0;return f()"
])("restores a labeled function across generator suspension: %s", async body => {
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
