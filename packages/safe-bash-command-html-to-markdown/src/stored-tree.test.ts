import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { Budget } from "./budget.js";
import { settings } from "./options.js";
import { Parser } from "./parser.js";
import { convert } from "./fixtures.js";
import { TextStore } from "./stored-text.js";
import { StoredTree } from "./stored-tree.js";

test("event trees retain hierarchy and relevant attributes in caller storage", async () => {
  const context = (await convert("")).context;
  const storage = new PagedStorage({ ...context, fs: new MemoryFileSystem() }, 1);
  const text = new TextStore(storage), tree = new StoredTree(storage, text);
  try {
    const root = await tree.create("root");
    const parser = new Parser(new Budget(context, settings({})), tree.sink(root));
    await parser.feed('<ul><li>a<li><a href="/x">b</a></ul><p>after');
    await parser.finish();
    const children = [];
    for await (const child of tree.children(root)) children.push(await tree.read(child));
    assert.deepEqual(children.map(node => node.tag), ["ul", "p"]);
    const items = [];
    for await (const child of tree.children(children[0]!.id)) items.push(await tree.read(child));
    assert.deepEqual(items.map(node => node.tag), ["li", "li"]);
    const links = [];
    for await (const child of tree.children(items[1]!.id)) links.push(await tree.read(child));
    let href = "";
    for await (const chunk of text.chunks(links[0]!.href)) href += chunk;
    assert.equal(href, "/x");
    assert.deepEqual(parser.root.children, []);
  } finally { await storage.close(); }
});
