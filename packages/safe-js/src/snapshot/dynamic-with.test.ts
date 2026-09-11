import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  {body: "let x=9;const o={x:1};with(o){[x=(yield 1,delete o.x,2)]=[]}return [x,o.x]", expected: [9, 2]},
  {body: "let x=9;const o={x:1,[Symbol.unscopables]:{x:true}};with(o){[x=(yield 1,o[Symbol.unscopables].x=false,2)]=[]}return [x,o.x]", expected: [2, 1]},
  {body: "let x=9;const o={x:1};with(o){({v:x=(yield 1,delete o.x,2)}={})}return [x,o.x]", expected: [9, 2]},
  {body: "let x=9;const o={x:1};with(o){x=yield 1}return [x,o.x]", expected: [9, 2]},
  {body: "let calls=0;const o={x:1};function select(){calls++;return o}with(select()){x=yield 1}return [o.x,calls]", expected: [2, 1]},
  {body: "let x=9;const o={x:1};with(o){x=(yield 1,delete o.x,2)}return [x,o.x]", expected: [9, 2]}
])("restores with assignment references: $body", async ({body, expected}) => {
  const source = `const C=(function*(){}).constructor;const iterator=C(${JSON.stringify(body)})();iterator.next();await 0;return iterator.next(2).value`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const saved = JSON.parse(await dump(pending));
    expect(await completed).toMatchObject({ok: true, returnValue: expected});
    expect(await run(source, {snapshot: restore(saved, {source})})).toMatchObject({ok: true, returnValue: expected});
  } finally {await completed;}
});
