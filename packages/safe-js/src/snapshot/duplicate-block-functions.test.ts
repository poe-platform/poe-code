import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  "{yield f();function f(){return 1}function f(){return 2}yield f()}return f()",
  "switch(1){case 1:yield f();function f(){return 1}break;case 2:function f(){return 2}}return f()",
  "let f=9;{yield f();function f(){return 1}function f(){return 2}yield f()}return f"
])("restores repeated block-function bindings: %s", async body => {
  const source = `const g=Function(${JSON.stringify(`return (function*(){${body}})()`)})();g.next();await 0;return [g.next(),g.next()]`;
  const expected: unknown = await runInNewContext(`(async function(){${source}})()`);
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const saved = JSON.parse(await dump(pending));
    expect(saved.pendingAwaits).toHaveLength(1);
    expect(await completed).toMatchObject({ok: true, returnValue: expected});
    expect(await run(source, {snapshot: restore(saved, {source})}))
      .toMatchObject({ok: true, returnValue: expected});
  } finally { await completed; }
});
