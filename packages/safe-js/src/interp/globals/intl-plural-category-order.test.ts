import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

// ECMA-402 edition 12, 17.3.2 step 4 specifies the order independently of ICU.
it.each([
  ["ar", "cardinal", ["zero", "one", "two", "few", "many", "other"]],
  ["fr", "cardinal", ["one", "many", "other"]],
  ["en", "ordinal", ["one", "two", "few", "other"]]
])("orders %s %s plural categories by the published specification", async (locale, type, expected) => {
  expect(await run(`return new Intl.PluralRules(${JSON.stringify(locale)},
    {type:${JSON.stringify(type)}}).resolvedOptions().pluralCategories`))
    .toMatchObject({ ok: true, returnValue: expected });
});

it.each(["pending", "completed"])("preserves ordered categories after %s cleanup and replay", async mode => {
  const source = `const p=new Intl.PluralRules('ar');
    p.resolvedOptions().pluralCategories.reverse();await 0;
    return p.resolvedOptions().pluralCategories;`;
  const pending = run(source);
  const settled = pending.catch(error => error);
  try {
    if (mode === "completed") await settled;
    const snapshot = JSON.parse(await dump(pending));
    for (const result of [await settled, await run(source, { snapshot }), await run(source, { snapshot })]) {
      expect(result).toMatchObject({ ok: true, returnValue: ["zero", "one", "two", "few", "many", "other"] });
    }
  } finally { await settled; }
});
