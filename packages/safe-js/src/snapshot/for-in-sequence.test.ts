import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  'const seen=[];for(const x in seen.push("before"),yield 0,{a:1})seen.push(x);return seen',
  'const seen=[];for(const x in seen.push("before"),(yield 0))seen.push(x);return seen'
])("restores a suspended for-in sequence without repeating effects: %s", async body => {
  const source = `const C=(function*(){}).constructor;const g=C(${JSON.stringify(body)})();g.next();await 0;return g.next({a:1})`;
  const expected: unknown = await runInNewContext(`(async function(){${source}})()`);
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const snapshot = JSON.parse(await dump(pending));
    expect(snapshot.pendingAwaits).toHaveLength(1);
    expect(await completed).toMatchObject({ok: true, returnValue: expected});
    expect(await run(source, {snapshot: restore(snapshot, {source})}))
      .toMatchObject({ok: true, returnValue: expected});
  } finally { await completed; }
});
