import assert from "node:assert/strict";
import test from "node:test";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { Budget } from "./budget.js";
import { settings } from "./options.js";
import { Parser } from "./parser.js";
import { convert, renderCases } from "./fixtures.js";
import { TextStore } from "./stored-text.js";
import { StoredTree } from "./stored-tree.js";
import { StoredRenderer } from "./stored-render.js";

for (const [name, html, expected] of renderCases) test(`stored rendering: ${name}`, async () => {
  const context = (await convert("")).context;
  const budget = new Budget(context, settings({}));
  const storage = new PagedStorage(context, 2), text = new TextStore(storage), tree = new StoredTree(storage, text);
  try {
    const root = await tree.create("root"), parser = new Parser(budget, tree.sink(root));
    await parser.feed(html); await parser.finish();
    const output = await new StoredRenderer(tree, budget).document(root);
    let actual = "";
    for await (const chunk of text.chunks(output)) actual += chunk;
    assert.equal(actual, expected);
  } finally { await storage.close(); }
});

import { Renderer } from "./render.js";

test("stored rendering preserves composed inline formatting against the existing renderer", async () => {
  const context = (await convert("")).context;
  const cases = ["em", "strong", "del", "span", "a", "code", "p"];
  for (const left of cases) for (const right of cases) {
    const html = `<${left}>a!</${left}>2<${right}>?b</${right}><${left}>c</${left}>`;
    const originalBudget = new Budget(context, settings({})), parser = new Parser(originalBudget);
    await parser.feed(html);
    const expected = await new Renderer(originalBudget).document(await parser.finish());
    const actual = await convert(html);
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.equal(actual.stdout, expected, html);
  }
});
