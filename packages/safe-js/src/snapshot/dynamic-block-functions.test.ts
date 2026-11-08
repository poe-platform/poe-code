import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  "const C=(function*(){}).constructor;const it=C('if(true)function answer(){return 7}yield 1;return answer()')();it.next();await 0;return it.next().value",
  "const f=Function('{function answer(){return 7}}return answer')();await 0;return f()",
  "const C=(async function(){}).constructor;return await C('await 0;{function answer(){return 7}}return answer()')()",
  "const C=(async function(){}).constructor;return await C('{function answer(){return 7}}await 0;return answer()')()",
  "const C=(function*(){}).constructor;const it=C('yield 1;{function answer(){return 7}}return answer()')();it.next();await 0;return it.next().value",
  "const C=(async function*(){}).constructor;const it=C('await 0;{function answer(){return 7}}yield answer()')();return (await it.next()).value"
])("restores legacy block-function bindings: %s", async source => {
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const saved = JSON.parse(await dump(pending));
    expect(await completed).toMatchObject({ok: true, returnValue: 7});
    expect(await run(source, {snapshot: restore(saved, {source})})).toMatchObject({ok: true, returnValue: 7});
  } finally {await completed;}
});
