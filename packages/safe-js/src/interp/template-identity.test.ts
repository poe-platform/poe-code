import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { Budget, createRealm, run } from "../core.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { parseModule } from "../parse/parser.js";
import { templateObject } from "./template-objects.js";

it.each([
  'let first;function tag(s){const same=first===s;first=s;return same}function call(){return tag`x`}call();return call()',
  'let first;function tag(s){const same=first===s.raw;first=s.raw;return same}function call(){return tag`x`}call();return call()',
  'function make(){return function(tag){return tag`x`}}const a=make();const b=make();const tag=s=>s;return a(tag)===b(tag)',
  'function call(tag){return tag`x`}const a=s=>s;const b=s=>s;return call(a)===call(b)',
  'const tag=s=>s;return tag`x`===tag`x`',
  'const tag=s=>s;function a(){return tag`x`}function b(){return tag`x`}return a()===b()'
])("matches native template source-site identity: %s", async source => {
  const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it("retains template identity across calls in one live realm", async () => {
  const realm = createRealm();
  try {
    expect(await realm.evaluate('function tag(s){return s}function call(){return tag`x`}const first=call();return true'))
      .toMatchObject({ ok: true, returnValue: true });
    expect(await realm.evaluate('return first===call()')).toMatchObject({ ok: true, returnValue: true });
  } finally {
    await realm.close();
  }
});

it("does not share template objects between realms", async () => {
  const first = createRealm();
  const second = createRealm();
  try {
    const source = 'function tag(s){return s}return tag`x`';
    const a = await first.evaluate(source);
    const b = await second.evaluate(source);
    if (!a.ok || !b.ok) throw new Error("Template realm fixture failed");
    expect(a.returnValue).not.toBe(b.returnValue);
  } finally {
    await first.close();
    await second.close();
  }
});

it("retains template roots only until the owning realm closes", async () => {
  const budget = new Budget();
  const realm = createRealm({ budget });
  try {
    expect(await realm.evaluate('function tag(s){return 1}tag`retained`;return true'))
      .toMatchObject({ ok: true, returnValue: true });
    expect([...budget.retainedValues()].some(value => Array.isArray(value) && Object.hasOwn(value, "raw"))).toBe(true);
  } finally {
    await realm.close();
  }
  expect([...budget.retainedValues()]).toEqual([]);
});

it("preserves template identity through public dump and replay", async () => {
  const source = 'function tag(s){return s}function call(){return tag`x`}const first=call();await 0;return first===call()';
  const execution = run(source);
  const snapshot = JSON.parse(await dump(execution));
  expect(await execution).toMatchObject({ ok: true, returnValue: true });
  expect(await run(source, { snapshot: restore(snapshot, { source }) }))
    .toMatchObject({ ok: true, returnValue: true });
});

it("discards cached identity and retained roots when the budget resets", () => {
  const statement = parseModule('tag`x`').body[0];
  if (statement.type !== "ExpressionStatement" || statement.expression.type !== "TaggedTemplateExpression")
    throw new Error("Missing template site");
  const budget = new Budget();
  const first = templateObject(statement.expression.quasi, budget);
  expect([...budget.retainedValues()]).toContain(first);
  budget.reset();
  expect([...budget.retainedValues()]).toEqual([]);
  expect(templateObject(statement.expression.quasi, budget)).not.toBe(first);
  budget.reset();
});

it.each([6000, 14000])("accounts for cached templates during later allocations (limit=%s)", async dataSize => {
  const budget = new Budget({ dataSize });
  const realm = createRealm({ budget });
  try {
    expect(await realm.evaluate('function tag(s){return 1}tag`' + 'b'.repeat(2000) + '`;return true'))
      .toMatchObject({ ok: true, returnValue: true });
    const allocation = realm.evaluate("return 'y'.repeat(5000).length");
    if (dataSize === 6000) await expect(allocation).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    else expect(await allocation).toMatchObject({ ok: true, returnValue: 5000 });
  } finally {
    await realm.close();
  }
  expect([...budget.retainedValues()]).toEqual([]);
});
