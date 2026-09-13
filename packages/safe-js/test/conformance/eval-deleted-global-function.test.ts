import { expect, it } from "vitest";
import { createTest262Realm } from "./realm.js";
import { run } from "../../src/run.js";
import { dump } from "../../src/dump.js";
import { restore } from "../../src/restore.js";
import { lint } from "../../src/lint/index.js";

// ECMA-262 (2025) B.3.2.3: assignment uses SetMutableBinding(..., false)
// on the variable environment even when the configurable binding was deleted.
it.each(["eval", "(0,eval)"])("recreates a deleted global block function through %s", async call => {
  const realm = createTest262Realm();
  try {
    expect(await realm.evaluate(`${call}("delete globalThis.f; {function f(){return 7}}");
      var d=Object.getOwnPropertyDescriptor(globalThis,"f");
      [f(),d.writable,d.enumerable,d.configurable].join(",")`))
      .toEqual({status: "normal", value: "7,true,true,true"});
  } finally { await realm.dispose(); }
});

it("ignores failed recreation on a now nonextensible global", async () => {
  const realm = createTest262Realm();
  try {
    expect(await realm.evaluate(`eval("delete globalThis.f; Object.preventExtensions(globalThis); {function f(){}}"); typeof f`))
      .toEqual({status: "normal", value: "undefined"});
  } finally { await realm.dispose(); }
});

it.each(["eval('{function f(){return 7}}'); f()", "eval('\"use strict\"; {function f(){}}'); typeof f"])(
  "preserves the neighboring declared or strict behavior: %s", async source => {
    const realm = createTest262Realm();
    try {
      expect(await realm.evaluate(source)).toEqual({status: "normal", value: source.endsWith("f()") ? 7 : "undefined"});
    } finally { await realm.dispose(); }
  }
);

it("preserves recreated globals and separate eval sources through repeated replay", async () => {
  const source = `(0,eval)("let count=7;delete globalThis.f;{function f(){return ++count}}");
    (0,eval)("let count=100;delete globalThis.g;{function g(){return ++count}}");
    await 0;return [globalThis.f(),globalThis.g(),globalThis.f(),typeof globalThis.process,typeof globalThis.require,
      globalThis.f.constructor("return typeof process")()];`;
  expect(lint(source).filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
  let pending = run(source);
  for (let cycle = 0; cycle < 3; cycle++) {
    const settled = pending.catch(error => error);
    try {
      const saved = JSON.parse(await dump(pending));
      expect(await settled).toMatchObject({ok: true, returnValue: [8,101,9,"undefined","undefined","undefined"]});
      pending = run(source, {snapshot: restore(saved, {source})});
    } finally { await settled; }
  }
  expect(await pending).toMatchObject({ok: true, returnValue: [8,101,9,"undefined","undefined","undefined"]});
  const completed = JSON.parse(await dump(pending));
  expect(await run(source, {snapshot: restore(completed, {source})}))
    .toMatchObject({ok: true, returnValue: [8,101,9,"undefined","undefined","undefined"]});
});
