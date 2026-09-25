import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import * as api from "docx";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";

const namespace = "http://schemas.microsoft.com/office/word/2018/wordml/cex";
console.log(JSON.stringify({ ready: true }));
for await (const raw of createInterface({ input: process.stdin })) {
  const request = JSON.parse(raw) as {
    input: string; limits: NonNullable<api.ArchiveContext["limits"]>;
    route: "native-sdk" | "native-cli"; depth: number;
    capacity: "sufficient" | "insufficient";
  };
  const input = new Uint8Array(Buffer.from(request.input, "base64"));
  const signal = new AbortController().signal;
  const budget = new api.DocumentBudget({ xmlDepth: 8192,
    ...(request.capacity === "insufficient" ? { retainedBytes: request.depth === 4096 ? 67108864 : 1 } : {}) }, signal);
  try {
    let data: api.CommentReadData;
    if (request.route === "native-sdk") {
      data = await api.inspectDocumentComments(input, { operation: "comments.list", options: {} }, { limits: request.limits, signal, budget });
      assert.ok(budget.usage.retainedBytes >= data.extensions.reduce((sum, extension) =>
        sum + extension.entries.reduce((total, entry) => total + entry.path.length * 8, 0), 0));
    } else {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input", input);
      const shell = new Shell({ fs, limits: { maxOutputBytes: 67108864 } }).use(docxCommands({
        engine: api.createDocxInspectionCommandEngine({ limits: request.limits, documentLimits: { xmlDepth: 8192 } })
      }));
      try {
        const result = await shell.exec("docx comments list /input --json" + (request.capacity === "insufficient"
          ? " --limit retainedBytes=" + (request.depth === 4096 ? 67108864 : 1) : ""));
        assert.deepEqual(await fs.readFile("/input"), input);
        if (result.exitCode !== 0) {
          console.log(JSON.stringify({ ok: false, code: JSON.parse(result.stdout).errors[0].code }));
          continue;
        }
        const actual = JSON.parse(result.stdout).data;
        assert.equal(actual.items.length, 1);
        assert.equal(actual.items[0].details.commentId, 43);
        assert.equal(actual.items[0].details.modern, true);
        assert.equal(actual.items[0].text, "Stored comment");
        data = await api.inspectDocumentComments(input, { operation: "comments.list", options: {} }, {
          limits: request.limits, signal, budget: new api.DocumentBudget({ xmlDepth: 8192 }, signal)
        });
      } finally { await shell.dispose(); }
    }

    // Keep the complete inventory in its native process: serializing every
    // ancestor path would transfer millions of redundant numbers to the runner.
    assert.deepEqual(data.items.map(item => [item.comment_id, item.text]), [[43, "Stored comment"]]);
    assert.equal(data.modern, "preserve");
    const extension = data.extensions.find(item => item.part === "/word/metadata.xml")!;
    assert.equal(extension.kind, "commentsExtensible");
    assert.equal(extension.entries.length, request.depth + 4);
    const leaf = extension.entries.at(-1)!;
    assert.deepEqual({ name: leaf.name, namespace: leaf.namespace, path: leaf.path,
      attributes: leaf.attributes.map(attribute => ({ name: attribute.name, namespace: attribute.namespace, value: attribute.value })) }, {
      name: "leaf", namespace, path: Array(request.depth + 3).fill(0),
      attributes: [{ name: "stored", namespace, value: "海" }]
    });
    console.log(JSON.stringify({ ok: true }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, code: (error as { code?: string }).code ?? (error as Error).name,
      error: String(error), stack: (error as Error).stack }));
  }
}
