import { Volume } from "memfs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import { useNativeProcess } from "../tests/native-process.js";

const execute = useNativeProcess(["packages/docx/tests/fixtures/comment-extension-native.mjs"]);

const namespace = "http://schemas.microsoft.com/office/word/2018/wordml/cex";
async function prepare(strict: boolean, kind: "docx" | "dotx", depth: number, capacity: "sufficient" | "insufficient") {
  const seed = await textFixture('<w:p><w:r><w:t>Retained coast</w:t></w:r></w:p>', {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="43" w:author="Original"><w:p><w:r><w:t>Stored comment</w:t></w:r></w:p></w:comment></w:comments>` },
    metadata: { kind: "commentsExtensible", xml: `<m:commentsExtensible xmlns:m="${namespace}"/>` }
  }, strict, { kind });
  const files = readPackage(seed), limits = { ...textContext.limits, maxArchiveBytes: 1048576, maxEntryBytes: 1048576, maxTotalBytes: 1048576, maxRetainedBytes: 536870912 };
  files.set("word/metadata.xml", new TextEncoder().encode(`<m:commentsExtensible xmlns:m="${namespace}"><m:commentExtensible m:durableId="00000027"><m:extLst>${'<m:future>'.repeat(depth)}<m:leaf m:stored="海"/>${'</m:future>'.repeat(depth)}</m:extLst></m:commentExtensible></m:commentsExtensible>`));
  const relationships = new api.DocumentXmlEditor(files.get("word/_rels/document.xml.rels")!);
  relationships.setAttribute(relationships.root.children.find(node => node.attributes.some(attribute => attribute.localName === "Id" && attribute.value === "metadata"))!, "Type", "http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible");
  files.set("word/_rels/document.xml.rels", relationships.serialize());
  const memory = Volume.fromJSON({ "/input": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...files].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-03-04T05:06:08Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, { ...textContext, limits });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), context = { ...textContext, limits, budget: new api.DocumentBudget({ xmlDepth: 8192, ...(capacity === "insufficient" ? { retainedBytes: depth === 4096 ? 67108864 : 1 } : {}) }, textContext.signal) };
  return { input, limits, memory, files, context };
}
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "cli", "native-sdk", "native-cli"] as const) for (const depth of [32, 4096]) for (const capacity of ["sufficient", "insufficient"] as const)
describe(`${route} inventories inert modern comment metadata at admitted depth ${depth}; capacity=${capacity}; ${kind}; strict=${strict}`, async () => {
  let prepared: Awaited<ReturnType<typeof prepare>>;
  let data: api.CommentReadData | undefined;
  beforeEach(async () => {
    data = undefined;
    prepared = await prepare(strict, kind, depth, capacity);
    if (route.startsWith("native-")) expect(await execute({ phase: "prepare", input: Buffer.from(prepared.input).toString("base64"), limits: prepared.limits, route, depth, capacity })).toEqual({ ok: true });
  }, 5000);
  it("inventories admitted metadata without mutating the archive", async () => {
    const { input, limits, memory, files, context } = prepared;
    if (route === "native-sdk" || route === "native-cli") {
      const response = await execute({ phase: "execute" }) as { ok: boolean; code?: string; stack?: string };
      expect(response, response.stack).toMatchObject(capacity === "insufficient" ? { ok: false, code: "limit-exceeded" } : { ok: true });
      expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
      expect(readPackage(input)).toEqual(files);
      return;
    } else if (route === "sdk") {
      const result = api.inspectDocumentComments(input, { operation: "comments.list", options: {} }, context);
      if (capacity === "insufficient") { await expect(result).rejects.toMatchObject({ code: "limit-exceeded" }); expect(readPackage(input)).toEqual(files); return; }
      data = await result;
    }
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs, limits: { maxOutputBytes: 67108864 } }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits: { xmlDepth: 8192 } }) }));
      try { const result = await shell.exec("docx comments list /input --json" + (capacity === "insufficient" ? ` --limit retainedBytes=${depth === 4096 ? 67108864 : 1}` : "")); if (capacity === "insufficient") { expect(result.exitCode, result.stdout + result.stderr).toBe(4); expect(JSON.parse(result.stdout).errors[0].code).toBe("limit-exceeded"); expect(await fs.readFile("/input")).toEqual(input); return; } expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data).toMatchObject({ items: [{ kind: "comments", text: "Stored comment", details: { commentId: 43, modern: true } }] });
        expect(await fs.readFile("/input")).toEqual(input); }
      finally { await shell.dispose(); }
    }
  });
  afterEach(async () => {
    try {
      const { input, limits, memory, files, context } = prepared;
      if (route.startsWith("native-")) expect(await execute({ phase: "verify" })).toEqual({ ok: true });
      if (route === "sdk" && capacity === "sufficient") expect(data).toBeDefined();
      if (data) {
        expect(data.items.map(item => [item.comment_id, item.text])).toEqual([[43, "Stored comment"]]); expect(data.modern).toBe("preserve");
        const extension = data.extensions.find(item => item.part === "/word/metadata.xml")!;
        expect(extension.kind).toBe("commentsExtensible"); expect(extension.entries).toHaveLength(depth + 4);
        expect(extension.entries.at(-1)).toMatchObject({ name: "leaf", namespace, path: Array(depth + 3).fill(0), attributes: [{ name: "stored", namespace, value: "海" }] });
        if (route === "sdk") expect(context.budget.usage.retainedBytes).toBeGreaterThanOrEqual(extension.entries.reduce((sum, entry) => sum + entry.path.length * 8, 0));
      }
      expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input); expect(readPackage(input)).toEqual(files);
    } finally { data = undefined; prepared = undefined!; }
  }, 5000);
});
