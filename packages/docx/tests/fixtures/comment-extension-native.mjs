import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import * as api from "../../dist/index.js";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";

const namespace = "http://schemas.microsoft.com/office/word/2018/wordml/cex";
let state;
console.log(JSON.stringify({ ready: true }));
for await (const raw of createInterface({ input: process.stdin })) {
  const message = JSON.parse(raw);
  try {
    if (message.phase === "prepare") {
      const input = new Uint8Array(Buffer.from(message.input, "base64"));
      const signal = new AbortController().signal;
      const budget = new api.DocumentBudget({ xmlDepth: 8192,
        ...(message.capacity === "insufficient" ? { retainedBytes: message.depth === 4096 ? 67108864 : 1 } : {}) }, signal);
      state = { request: message, input, signal, budget };
    } else if (message.phase === "execute") {
      const { request, input, signal, budget } = state;
      if (request.route === "native-sdk") {
        state.data = await api.inspectDocumentComments(input, { operation: "comments.list", options: {} }, { limits: request.limits, signal, budget });
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
        } finally { await shell.dispose(); }
      }
    } else if (message.phase === "verify") {
      const { request, input, signal, budget } = state;
      if (request.capacity === "sufficient") {
        const data = request.route === "native-cli" ? await api.inspectDocumentComments(input,
          { operation: "comments.list", options: {} }, { limits: request.limits, signal, budget: new api.DocumentBudget({ xmlDepth: 8192 }, signal) }) : state.data;
        if (request.route === "native-sdk") assert.ok(budget.usage.retainedBytes >= data.extensions.reduce((sum, extension) =>
          sum + extension.entries.reduce((total, entry) => total + entry.path.length * 8, 0), 0));
        // Verify the complete inventory in its native process, avoiding transfer of millions of redundant path numbers.
        assert.deepEqual(data.items.map(item => [item.comment_id, item.text]), [[43, "Stored comment"]]);
        assert.equal(data.modern, "preserve");
        const extension = data.extensions.find(item => item.part === "/word/metadata.xml");
        assert.equal(extension.kind, "commentsExtensible");
        assert.equal(extension.entries.length, request.depth + 4);
        const leaf = extension.entries.at(-1);
        assert.deepEqual({ name: leaf.name, namespace: leaf.namespace, path: leaf.path,
          attributes: leaf.attributes.map(attribute => ({ name: attribute.name, namespace: attribute.namespace, value: attribute.value })) }, {
          name: "leaf", namespace, path: Array(request.depth + 3).fill(0),
          attributes: [{ name: "stored", namespace, value: "海" }]
        });
      }
      state = undefined;
    } else throw new Error("Unknown fixture phase");
    console.log(JSON.stringify({ ok: true }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, code: error.code ?? error.name, error: String(error), stack: error.stack }));
  }
}
