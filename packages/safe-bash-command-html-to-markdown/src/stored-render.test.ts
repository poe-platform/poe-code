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

for (const mode of ["raw", "transparent", "rows", "blocks"] as const) test(`deep ${mode} traversal retains a fixed number of child iterators`, async () => {
  const context = (await convert("")).context, budget = new Budget(context, settings({}));
  const storage = new PagedStorage(context, 1), text = new TextStore(storage), tree = new StoredTree(storage, text);
  const children = tree.children.bind(tree);
  let live = 0, peak = 0;
  tree.children = async function* (id, reverse) {
    peak = Math.max(peak, ++live);
    try { yield* children(id, reverse); } finally { live--; }
  };
  try {
    const root = await tree.create("root"), outer = await tree.create(mode === "raw" ? "pre" : mode === "rows" ? "table" : "unknown");
    await tree.append(root, outer);
    let parent = outer;
    for (let depth = 0; depth < 128; depth++) {
      const child = await tree.create(mode === "blocks" ? "div" : "unknown"); await tree.append(parent, child); parent = child;
    }
    await tree.append(parent, await tree.create("text", { text: await text.from("ok") }));
    const renderer = new StoredRenderer(tree, budget), renderChildren = renderer.children.bind(renderer);
    let pending = 0, peakPending = 0;
    renderer.children = async (...args) => {
      peakPending = Math.max(peakPending, ++pending);
      try { return await renderChildren(...args); } finally { pending--; }
    };
    const output = await renderer.document(root);
    assert.ok(peakPending <= 2, `retained ${peakPending} render calls for 128 nested elements`);
    let actual = "";
    for await (const chunk of text.chunks(output)) actual += chunk;
    assert.equal(actual, mode === "raw" ? "```\nok\n```\n" : "ok\n");
    assert.ok(peak <= 5, `retained ${peak} iterators for 128 nested elements`);
    assert.equal(live, 0);
  } finally { await storage.close(); }
});

for (const [name, open, close, depth] of [
  ["emphasis", "<em><strong>", "</strong></em>", 24],
  ["lists", "<ul><li>before", "after</li><span>extra</span></ul>", 8],
  ["tables", "<table>loose<tr><th>head</th><td>", "</td>tail</tr><tr><td>end</td></tr></table>", 4],
] as const) test(`nested ${name} preserves formatting with stored continuations`, async () => {
  const context = (await convert("")).context;
  const legacyBudget = new Budget(context, settings({})), legacy = new Parser(legacyBudget);
  const budget = new Budget(context, settings({})), storage = new PagedStorage(context, 1), text = new TextStore(storage), tree = new StoredTree(storage, text);
  try {
    const root = await tree.create("root"), parser = new Parser(budget, tree.sink(root));
    for (let index = 0; index < depth; index++) { await parser.feed(open); await legacy.feed(open); }
    await parser.feed("x | y"); await legacy.feed("x | y");
    for (let index = 0; index < depth; index++) { await parser.feed(close); await legacy.feed(close); }
    await parser.finish();
    const expected = await new Renderer(legacyBudget).document(await legacy.finish());
    const renderer = new StoredRenderer(tree, budget), children = renderer.children.bind(renderer);
    let live = 0, peak = 0;
    renderer.children = async (...args) => {
      peak = Math.max(peak, ++live);
      try { return await children(...args); } finally { live--; }
    };
    let actual = "";
    for await (const chunk of text.chunks(await renderer.document(root))) actual += chunk;
    assert.equal(actual, expected);
    assert.equal(peak, 1, "formatting must not retain recursive render calls");
  } finally { await storage.close(); }
});
