import assert from "node:assert/strict";
import test from "node:test";
import { Shell, cloudflareWorkerLimits } from "../../src/shell/index.js";
import { htmlToMarkdownCommands } from "../../src/commands/html-to-markdown/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { convert } from "./html-to-markdown/helpers.js";
import { Budget } from "../../src/commands/html-to-markdown/budget.js";
import { Parser } from "../../src/commands/html-to-markdown/parser.js";
import { settings } from "../../src/commands/html-to-markdown/options.js";

for (const plugin of [htmlToMarkdownCommands, agentCommands]) {
  test(`Worker ${plugin.name} bounds large zero-output trees despite a small output cap`, async t => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/empty.html", Buffer.from("<p></p>".repeat(120_000)));
    const shell = new Shell({ fs, limits: { ...cloudflareWorkerLimits, maxOutputBytes: 1024 } }).use(plugin());
    t.after(() => shell.dispose());
    const result = await shell.exec("html-to-markdown /empty.html");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /nodes limit exceeded/);
  });
}

test("node accounting rejects before retaining the next element or text node", async () => {
  const { context } = await convert("");
  for (const extra of ["<p>", "text"]) {
    const budget = new Budget(context, settings({ limits: { maxNodes: 2 } }));
    const parser = new Parser(budget);
    await parser.feed("<p></p><p></p>");
    await assert.rejects(async () => { await parser.feed(extra); await parser.finish(); }, /nodes limit exceeded/);
    assert.equal(parser.root.children.length, 2);
    assert.equal(budget.nodes, 2);
  }
});

test("Worker ceilings cannot be raised by registration and ordinary HTML still converts", async t => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.html", Buffer.from("<div>".repeat(65)));
  const shell = new Shell({ fs, limits: cloudflareWorkerLimits }).use(htmlToMarkdownCommands({ limits: { maxDepth: Infinity } }));
  t.after(() => shell.dispose());
  const rejected = await shell.exec("html-to-markdown /input.html");
  assert.equal(rejected.exitCode, 1);
  assert.match(rejected.stderr, /depth limit exceeded/);
  await fs.writeFile("/input.html", Buffer.from("<h1>Hello</h1><p>World</p>"));
  assert.equal((await shell.exec("html-to-markdown /input.html")).stdout, "# Hello\n\nWorld\n");
});

test("invocation profiles preserve tighter registration ceilings", async t => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.html", Buffer.from("<p></p>".repeat(3)));
  const shell = new Shell({ fs, limits: cloudflareWorkerLimits }).use(htmlToMarkdownCommands({ limits: { maxNodes: 2 } }));
  t.after(() => shell.dispose());
  const result = await shell.exec("html-to-markdown /input.html", { limits: { commandLimits: { htmlToMarkdown: { maxTokens: 100 } } } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /nodes limit exceeded/);
});

test("Worker token ceiling bounds zero-output comments", async t => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.html", Buffer.from("<!--x-->".repeat(30_001)));
  const shell = new Shell({ fs, limits: cloudflareWorkerLimits }).use(htmlToMarkdownCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec("html-to-markdown /input.html");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /tokens limit exceeded/);
});
