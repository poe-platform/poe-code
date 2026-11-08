import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it("preserves generator aliases, origins, suspended lexical frames and channel history", async () => {
  const source = "function* values(seed){const next=yield seed;yield next}const iterator=values(3);const alias=iterator;iterator.next();await 0;return alias.next(4).value";
  const pending = run(source);
  try {
    const snapshot = JSON.parse(await dump(pending));
    expect(snapshot.bindings.iterator).toEqual(snapshot.bindings.alias);
    const node = snapshot.heap[String(snapshot.bindings.iterator.id)];
    expect(node).toMatchObject({ kind: "guest-generator", state: "suspended", astNodeId: expect.any(Number), yieldNodeId: expect.any(Number),
      sent: [{ type: "normal", value: { kind: "undefined" } }] });
    const scope = snapshot.heap[String(node.suspendedScope.id)];
    const next = scope.bindings.find(([name]: [string, number]) => name === "next");
    expect(scope.cells[next[1]]).toEqual({ kind: "const", initialized: false });
    expect(await pending).toMatchObject({ ok: true, returnValue: 4 });
    expect(await run(source, { snapshot: restore(snapshot, { source }) })).toMatchObject({ ok: true, returnValue: 4 });
  } finally { await pending; }
});

it.each(["history", "origin", "yield"])("rejects forged generator %s", async corruption => {
  const source = "function ordinary(){}function* values(){yield 1}const iterator=values();iterator.next();return 3";
  const pending = run(source);
  try {
    const snapshot = JSON.parse(await dump(pending));
    const node = snapshot.heap[String(snapshot.bindings.iterator.id)];
    let message: string;
    if (corruption === "history") { node.sent[0].type = "invalid"; message = "Invalid generator completion type"; }
    else if (corruption === "origin") {
      const ordinary = snapshot.heap[String(snapshot.bindings.ordinary.id)];
      node.astNodeId = ordinary.astNodeId;
      message = "Invalid generator AST identity";
    } else { node.yieldNodeId = node.astNodeId; message = "Invalid generator AST identity"; }
    expect(() => restore(snapshot, { source })).toThrow(message);
  } finally { await pending; }
});

it.each(["start", "done"])("captures a %s generator without inventing a yield point", async state => {
  const source = `function* values(){return 3}const iterator=values();${state === "done" ? "iterator.next();" : ""}return 3`;
  const pending = run(source);
  await pending;
  const snapshot = JSON.parse(await dump(pending));
  const node = snapshot.heap[String(snapshot.bindings.iterator.id)];
  expect(node).toMatchObject({ kind: "guest-generator", state, async: false, astNodeId: expect.any(Number) });
  expect(node.yieldNodeId).toBeUndefined();
  expect(await run(source, { snapshot: restore(snapshot, { source }) })).toMatchObject({ ok: true, returnValue: 3 });
});

it("captures an async generator's completed-run suspension and history", async () => {
  const source = "async function* values(seed){yield seed}const iterator=values(3);return (await iterator.next()).value";
  const pending = run(source);
  expect(await pending).toMatchObject({ ok: true, returnValue: 3 });
  const snapshot = JSON.parse(await dump(pending));
  const node = snapshot.heap[String(snapshot.bindings.iterator.id)];
  expect(node).toMatchObject({ kind: "guest-generator", state: "suspended", async: true, yieldNodeId: expect.any(Number),
    sent: [{ type: "normal", value: { kind: "undefined" } }] });
  expect(await run(source, { snapshot: restore(snapshot, { source }) })).toMatchObject({ ok: true, returnValue: 3 });
});
