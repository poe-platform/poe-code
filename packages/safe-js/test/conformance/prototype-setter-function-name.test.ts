import { expect, it } from "vitest";
import { createTest262Realm } from "./realm.js";
import { run } from "../../src/run.js";
import { dump } from "../../src/dump.js";
import { restore } from "../../src/restore.js";
import { lint } from "../../src/lint/index.js";

it.each([
  ["function () {}", ""],
  ["() => 1", ""],
  ["async function () {}", ""],
  ["function* () {}", ""],
  ["async function* () {}", ""],
  ["class {}", ""],
  ["function explicit() {}", "explicit"]
])("does not infer a prototype setter name for %s", async (expression, name) => {
  const realm = createTest262Realm();
  try {
    expect(await realm.evaluate(`Object.getPrototypeOf({__proto__: ${expression}}).name`))
      .toEqual({ status: "normal", value: name });
  } finally { await realm.dispose(); }
});

it("preserves dynamic prototype closures, source and authority through repeated replay", async () => {
  const source = `const first = eval('(function () { let x=7; return {__proto__: function () {return ++x}} })()');
    const second = Function('let x=100; return {__proto__: function () {return ++x}}')();
    await 0;
    const f = Object.getPrototypeOf(first), g = Object.getPrototypeOf(second);
    return [f.name, g.name, f(), g(), f(), f.toString(),
      f.constructor('return typeof process + "," + typeof require')()];`;
  const expected = ["", "", 8, 101, 9, "function () {return ++x}", "undefined,undefined"];
  expect(lint(source).filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
  let pending = run(source);
  for (let cycle = 0; cycle < 3; cycle++) {
    const settled = pending.catch(error => error);
    try {
      const saved = JSON.parse(await dump(pending));
      expect(await settled).toMatchObject({ ok: true, returnValue: expected });
      pending = run(source, { snapshot: restore(saved, { source }) });
    } finally { await settled; }
  }
  expect(await pending).toMatchObject({ ok: true, returnValue: expected });
  const completed = JSON.parse(await dump(pending));
  expect(await run(source, { snapshot: restore(completed, { source }) }))
    .toMatchObject({ ok: true, returnValue: expected });
});

it.each([
  '({["__proto__"]: function () {}}).__proto__.name',
  '({__proto__() {}}).__proto__.name',
  'Object.getOwnPropertyDescriptor({get __proto__() {}}, "__proto__").get.name',
  'Object.getOwnPropertyDescriptor({set __proto__(value) {}}, "__proto__").set.name'
])("retains ordinary property name inference: %s", async source => {
  const realm = createTest262Realm();
  try {
    expect(await realm.evaluate(source)).toEqual({
      status: "normal",
      value: source.includes("{get ") ? "get __proto__" : source.includes("{set ") ? "set __proto__" : "__proto__"
    });
  } finally { await realm.dispose(); }
});
