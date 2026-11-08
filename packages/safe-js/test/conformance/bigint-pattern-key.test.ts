import { expect, it } from "vitest";
import { createTest262Realm } from "./realm.js";
import { run } from "../../src/run.js";
import { dump } from "../../src/dump.js";
import { restore } from "../../src/restore.js";
import { lint } from "../../src/lint/index.js";

// LiteralPropertyName : NumericLiteral uses ToString(NumericValue).
it.each([
  ["var {1n:value}={'1':7}; value", 7],
  ["var value; ({0xfn:value}={'15':8}); value", 8],
  ["var {999999999999999999n:value}={'999999999999999999':9}; value", 9],
  ["var {0b1n:value,...rest}={'1':7,other:8}; [value,Object.keys(rest)].join(';')", "7;other"],
  ["var {0o10n:value=9}={}; value", 9],
  ["var {[1n]:value}={'1':7}; value", 7],
  ["var {'1':value}={'1':7}; value", 7]
])("evaluates static and computed property keys: %s", async (source, value) => {
  const realm = createTest262Realm();
  try {
    expect(await realm.evaluate(source)).toEqual({ status: "normal", value });
  } finally { await realm.dispose(); }
});

it("preserves dynamic source keys and host isolation through repeated replay", async () => {
  const source = `const read=Function("var {0xfn:value,...rest}={'15':7,other:8};return ()=>[value,Object.keys(rest).join(','),typeof globalThis.process,typeof globalThis.require]")();
    await 0;return read();`;
  expect(lint(source).filter(item => item.severity === "error")).toEqual([]);
  let pending = run(source);
  for (let cycle = 0; cycle < 3; cycle++) {
    const settled = pending.catch(error => error);
    try {
      const saved = JSON.parse(await dump(pending));
      expect(await settled).toMatchObject({ ok: true, returnValue: [7, "other", "undefined", "undefined"] });
      pending = run(source, { snapshot: restore(saved, { source }) });
    } finally { await settled; }
  }
  expect(await pending).toMatchObject({ ok: true, returnValue: [7, "other", "undefined", "undefined"] });
  const saved = JSON.parse(await dump(pending));
  expect(await run(source, { snapshot: restore(saved, { source }) }))
    .toMatchObject({ ok: true, returnValue: [7, "other", "undefined", "undefined"] });
});
