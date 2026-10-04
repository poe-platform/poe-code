import assert from "node:assert/strict";
import test from "node:test";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { Budget } from "./budget.js";
import { settings } from "./options.js";
import { Parser } from "./parser.js";
import { convert, renderCases } from "./fixtures.js";
import { TextStore } from "./stored-text.js";
import { StoredTree } from "./stored-tree.js";
import { StoredParser } from "./stored-parser.js";
import { StoredRenderer } from "./stored-render.js";

for (const [name, html, expected] of renderCases) test(`stored parser: ${name}`, async () => {
  const context = (await convert("")).context, budget = new Budget(context, settings({}));
  const storage = new PagedStorage(context, 2), text = new TextStore(storage), tree = new StoredTree(storage, text);
  try {
    const root = await tree.create("root"), parser = new StoredParser(budget, storage, tree, root);
    for (const character of html) await parser.feed(character);
    await parser.finish();
    const output = await new StoredRenderer(tree, budget).document(root);
    let actual = "";
    for await (const chunk of text.chunks(output)) actual += chunk;
    assert.equal(actual, expected);
  } finally { await storage.close(); }
});

test("unfinished large tokens spill before a closing bracket arrives", async () => {
  const context = (await convert("")).context, original = context.fs.open!.bind(context.fs);
  let opened = 0, closed = 0;
  context.fs.open = async (path, options) => {
    opened++;
    const fd = await original(path, options);
    return { ...fd, capabilities: fd.capabilities, stat: fd.stat.bind(fd), read: fd.read.bind(fd), write: fd.write.bind(fd), truncate: fd.truncate.bind(fd), sync: fd.sync.bind(fd),
      async close(options) { closed++; return fd.close(options); },
    };
  };
  const storage = new PagedStorage(context, 1), text = new TextStore(storage), tree = new StoredTree(storage, text);
  try {
    const root = await tree.create("root"), parser = new StoredParser(new Budget(context, settings({})), storage, tree, root);
    await parser.feed('<p title="');
    for (let index = 0; index < 32; index++) await parser.feed("x".repeat(2048));
    assert.equal(opened, 1);
    await parser.feed('">ok</p>'); await parser.finish();
    let result = "";
    const output = await new StoredRenderer(tree, new Budget(context, settings({}))).document(root);
    for await (const chunk of text.chunks(output)) result += chunk;
    assert.equal(result, "ok\n");
  } finally { await storage.close(); }
  assert.equal(closed, 1);
});

test("many open names and recovery use caller-backed ancestry", async () => {
  const context = (await convert("")).context, budget = new Budget(context, settings({}));
  const storage = new PagedStorage(context, 1), text = new TextStore(storage), tree = new StoredTree(storage, text);
  try {
    const root = await tree.create("root"), parser = new StoredParser(budget, storage, tree, root);
    for (let index = 0; index < 100; index++) await parser.feed(`<custom-${index}>`);
    await parser.feed("</custom-0><p>after</p>"); await parser.finish();
    const children: string[] = [];
    for await (const child of tree.children(root)) children.push((await tree.read(child)).tag);
    assert.deepEqual(children, ["unknown", "p"]);
  } finally { await storage.close(); }
});

test("stored token parsing preserves literal recovery and duplicate attributes", async () => {
  const corpus = ['<p / x=1>text</p>', '<p / >text', '<p a=1 a=2 title="x">ok', '<p title=unclosed', '<p\\x80>x', '<p=bad>keep', '<p a="x>y">z', '<p a=1<em>x', '<p title="&amp;">ok'];
  for (const tag of ["p", "a", "li", "td", "textarea", "script", "custom-long-name-with-suffix"]) {
    for (const tail of ["", "/", " / ", ' title="x>y"', " href=/path", ' alt="&amp;&#128512;"']) {
      corpus.push(`<${tag}${tail}>before<em>x</em></${tag}>after`);
    }
  }
  const context = (await convert("")).context;
  for (const html of corpus) {
    const budget = new Budget(context, settings({})), parser = new Parser(budget), storage = new PagedStorage(context, 2), text = new TextStore(storage), tree = new StoredTree(storage, text);
    try {
      const root = await tree.create("root"), stored = new StoredParser(new Budget(context, settings({})), storage, tree, root);
      for (let offset = 0; offset < html.length; offset += 3) await stored.feed(html.slice(offset, offset + 3));
      await stored.finish(); await parser.feed(html);
      const { Renderer } = await import("./render.js");
      const expected = await new Renderer(budget).document(await parser.finish());
      let actual = "";
      for await (const chunk of text.chunks(await new StoredRenderer(tree, new Budget(context, settings({}))).document(root))) actual += chunk;
      assert.equal(actual, expected, html);
    } finally { await storage.close(); }
  }
});

test("Unicode duplicate attribute names keep whole-name lowercase semantics", async () => {
  const context = (await convert("")).context;
  const budget = new Budget(context, settings({ limits: { maxOutputBytes: 8 } }));
  const storage = new PagedStorage(context, 1), text = new TextStore(storage), tree = new StoredTree(storage, text);
  try {
    const root = await tree.create("root"), parser = new StoredParser(budget, storage, tree, root);
    await parser.feed('<p ΟΣ=x ος="this duplicate value must be ignored">ok</p>');
    await parser.finish();
  } finally { await storage.close(); }
});
