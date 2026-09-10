import { expect, it } from "vitest";
import { dump, restore, run } from "./index.js";

it.each(["bindings", "arguments", "imports", "importMeta"] as const)(
  "preserves a sibling Promise reached through settlement in %s",
  async (placement) => {
    const sibling = Promise.resolve(3);
    const incoming = { original: Promise.resolve({ sibling }), sibling };
    const expression = "return (await incoming.original).sibling === incoming.sibling";
    const result = placement === "bindings"
      ? await run(expression, { bindings: { incoming } })
      : placement === "arguments"
        ? await run(`export default async function(incoming) { ${expression} }`, {
            entryPointArgs: [incoming]
          })
        : placement === "imports"
          ? await run(`import { incoming } from 'inputs'; ${expression}`, {
              modules: { inputs: { incoming } }
            })
          : await run(`const incoming = import.meta.incoming; ${expression}`, {
              importMeta: { incoming }
            });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.returnValue).toBe(true);
  }
);

it("preserves settlement sibling identity through completed replay", async () => {
  const sibling = Promise.resolve(3);
  const incoming = { original: Promise.resolve({ sibling }), sibling };
  const source = "return (await incoming.original).sibling === incoming.sibling";
  const first = await run(source, { bindings: { incoming } });
  expect(first).toMatchObject({ ok: true, returnValue: true });
  let result = first;
  for (let count = 0; count < 3; count++) {
    const snapshot = JSON.parse(await dump(result));
    result = await run(source, { snapshot: restore(snapshot, { source }) });
    expect(result).toMatchObject({ ok: true, returnValue: true });
  }
});

it("replays a fulfillment back-reference without the original host Promise", async () => {
  const value: { original?: Promise<unknown> } = {};
  const original = Promise.resolve(value);
  value.original = original;
  const source = "return (await original).original === original";
  let result = await run(source, { bindings: { original } });
  delete value.original;
  expect(result).toMatchObject({ ok: true, returnValue: true });
  for (let count = 0; count < 3; count++) {
    const snapshot = JSON.parse(await dump(result));
    result = await run(source, { snapshot: restore(snapshot, { source }) });
    expect(result).toMatchObject({ ok: true, returnValue: true });
  }
});

it("rejects an undeclared input Promise reference in a journal outcome", async () => {
  const sibling = Promise.resolve(3);
  const incoming = { original: Promise.resolve({ sibling }), sibling };
  const source = "return (await incoming.original).sibling === incoming.sibling";
  const first = await run(source, { bindings: { incoming } });
  const saved = JSON.parse(await dump(first));
  const reference = `${saved.replay.calls[1].id}/promise`;
  const serialized = JSON.stringify(saved);
  expect(serialized.includes(reference)).toBe(true);
  const tampered = JSON.parse(serialized.replace(reference, "missing/promise"));
  await expect(run(source, { snapshot: restore(tampered, { source }) }))
    .rejects.toThrow("Missing replay promise capability 'missing/promise'");
});

it("replays mutual fulfillment references", async () => {
  const leftValue: { peer?: Promise<unknown> } = {};
  const rightValue: { peer?: Promise<unknown> } = {};
  const left = Promise.resolve(leftValue);
  const right = Promise.resolve(rightValue);
  leftValue.peer = right;
  rightValue.peer = left;
  const source = "return [(await left).peer === right, (await right).peer === left]";
  let result = await run(source, { bindings: { left, right } });
  delete leftValue.peer;
  delete rightValue.peer;
  expect(result).toMatchObject({ ok: true, returnValue: [true, true] });
  for (let count = 0; count < 2; count++) {
    result = await run(source, { snapshot: restore(JSON.parse(await dump(result)), { source }) });
    expect(result).toMatchObject({ ok: true, returnValue: [true, true] });
  }
});

it("preserves Promise references used as Map keys and Set entries in settlements", async () => {
  const sibling = Promise.resolve(3);
  const original = Promise.resolve({ map: new Map([[sibling, "value"]]), set: new Set([sibling]) });
  const source = "const value = await original; return [value.map.get(sibling), value.set.has(sibling)]";
  let result = await run(source, { bindings: { original, sibling } });
  expect(result).toMatchObject({ ok: true, returnValue: ["value", true] });
  result = await run(source, { snapshot: restore(JSON.parse(await dump(result)), { source }) });
  expect(result).toMatchObject({ ok: true, returnValue: ["value", true] });
});
