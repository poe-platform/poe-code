import { runInNewContext } from "node:vm";
import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { SnapshotValidationError } from "./validation.js";

it.each([
  ['return function f(){f=1;return typeof f}', 'f()'],
  ['return async function f(){await 0;f=1;return typeof f}', 'await f()'],
  ['return function* f(){yield 0;f=1;return typeof f}', '(()=>{const g=f();g.next();return g.next().value})()'],
  ['return function f(){return (function(){"use strict";f=1})()}', '(()=>{try{return f()}catch(e){return e.name}})()']
])("restores named function assignment semantics: %s", async (body, invocation) => {
  const source = `const f=Function(${JSON.stringify(body)})();await 0;return ${invocation}`;
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

it.each(["false", "mutable", "uninitialized", "primitive", "wrong-scope"])(
  "rejects a malformed named function binding: %s", async alteration => {
    const source = "const f=Function('return function f(){f=1;return typeof f}')();await 0;return f()";
    const pending = run(source);
    const completed = pending.catch(error => error);
    let snapshot;
    try { snapshot = JSON.parse(await dump(pending)); }
    finally { expect(await completed).toMatchObject({ok: true, returnValue: "function"}); }
    const nodes = Object.values(snapshot.heap) as Array<{
      kind: string; parent?: unknown;
      cells?: Array<{kind: string; initialized: boolean; value?: unknown; silentImmutable?: boolean}>;
    }>;
    const frame = nodes.find(node => node.kind === "scope-frame" &&
      node.cells?.some(cell => cell.silentImmutable));
    assert(frame?.cells);
    const cell = frame.cells.find(cell => cell.silentImmutable);
    assert(cell);
    if (alteration === "false") cell.silentImmutable = false;
    if (alteration === "mutable") cell.kind = "let";
    if (alteration === "uninitialized") {cell.initialized = false; delete cell.value;}
    if (alteration === "primitive") cell.value = 7;
    if (alteration === "wrong-scope") cell.value = frame.parent;
    expect(() => restore(snapshot, {source})).toThrow(SnapshotValidationError);
  }
);
