import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createDocumentArchive, createDocxInspectionCommandEngine, DocumentBudget, documentLimitDefaults, publishDocumentArchive, readDocumentArchive, parseDocumentXml, replaceDocumentText, extractDocumentText, writeArchive, writeDocumentArchive } from "./index.js";
import * as validation from "./validation.js";

const MiB = 1048576;
const limits = { maxArchiveBytes: 64 * MiB, maxEntryBytes: 64 * MiB, maxTotalBytes: 512 * MiB, maxMembers: 10000, maxPathBytes: 4096, maxDepth: 256, maxExtraBytes: 65536, maxCommentBytes: 65536, maxRetainedBytes: 2048 * MiB, chunkSize: 65536 };
const signal = new AbortController().signal;

async function fixture() {
  const archive = await createDocumentArchive({ content: { version: 1, blocks: [{ kind: "paragraph", text: "Coastal observation" }] } }, { limits, signal });
  const chunks: Uint8Array[] = [];
  await writeDocumentArchive(archive, { async write(bytes) { chunks.push(bytes); } }, { compression: "store", order: "name" }, { limits, signal });
  return { archive, bytes: new Uint8Array(Buffer.concat(chunks)) };
}

it("honors trusted node ceilings and lower-only operation limits before memfs edits", async () => {
  const { bytes } = await fixture();
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes), "/sentinel": "Keep original" });
  const before = volume.toJSON();
  async function invoke(hostNodes: number, operationLimit?: number) {
    let stdout = "";
    const args = ["text", "replace", "input.docx", "--find", "Coastal", "--with", "Harbor", "--first", "--dry-run", "--json"];
    if (operationLimit !== undefined) args.push("--limit", `xmlNodes=${operationLimit}`);
    const options = { limits, documentLimits: { xmlNodes: hostNodes } };
    const result = await createDocxInspectionCommandEngine(options).execute({ args: args.map(value => new TextEncoder().encode(value)), cwd: "/", signal,
      filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
      stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("Undeclared input"); } }; } },
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} } });
    return { ...result, body: JSON.parse(stdout) };
  }
  expect(await invoke(1)).toMatchObject({ exitCode: 4, body: { ok: false, affected: 0, errors: [{ code: "limit-exceeded" }] } });
  expect(await invoke(10000)).toMatchObject({ exitCode: 0, body: { ok: true, affected: 1 } });
  expect(await invoke(10000, 1)).toMatchObject({ exitCode: 4, body: { ok: false } });
  expect(await invoke(1, 2)).toMatchObject({ exitCode: 2, body: { ok: false } });
  expect(volume.toJSON()).toEqual(before);
  expect(documentLimitDefaults).toMatchObject({ expandedPackage: 256 * MiB, xmlPartBytes: 32 * MiB, xmlNodes: 2000000 });
});

it("uses admitted host validation capacities for both serialization and retained-byte publication", async () => {
  const { archive, bytes } = await fixture();
  const spy = vi.spyOn(validation, "validateDocumentArchive");
  try {
    const budget = new DocumentBudget({ expandedPackage: 512 * MiB, xmlPartBytes: 64 * MiB, xmlNodes: 5000000, retainedBytes: 2048 * MiB });
    await writeDocumentArchive(archive, { async write() {} }, { compression: "store", order: "name" }, { limits, signal, budget });
    expect(spy).toHaveBeenLastCalledWith(archive, expect.objectContaining({ maxBytes: 512 * MiB, maxParts: 10000, maxNodes: 5000000 }), expect.any(DocumentBudget));
    const admitted = await readDocumentArchive(bytes, { limits, signal, budget });
    await publishDocumentArchive(admitted, { output: "-", dryRun: true }, { limits, signal, budget, encoding: { compression: "store", order: "name" } }, undefined, bytes);
    expect(spy).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({ maxBytes: 512 * MiB, maxParts: 10000, maxNodes: 5000000 }), expect.any(DocumentBudget));
  } finally { spy.mockRestore(); }
});

it("charges attributes and retained text independently of an element-only census", () => {
  const bytes = new TextEncoder().encode('<root flag="yes"><leaf>Original note</leaf></root>');
  const exact = new DocumentBudget({ xmlNodes: 4 });
  parseDocumentXml(bytes, {}, exact);
  expect(exact.usage.xmlNodes).toBe(4);
  expect(() => parseDocumentXml(bytes, {}, new DocumentBudget({ xmlNodes: 3 }))).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
});

it("reports the default XML ceiling independently of larger archive media allowances", async () => {
  let stdout = "";
  const result = await createDocxInspectionCommandEngine({ limits }).execute({
    args: ["capabilities", "--json"].map(value => new TextEncoder().encode(value)), cwd: "/", signal,
    filesystem: { async readFile() { throw new Error("Discovery must not acquire input"); } },
    stdin: { async *[Symbol.asyncIterator]() { yield new Uint8Array(); } },
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(stdout).data.limits).toEqual(expect.arrayContaining([{ name: "xmlPartBytes", ceiling: 32 * MiB }, { name: "xmlNodes", ceiling: 2000000 }]));
});

it("rejects a next-style relationship between different definition kinds", async () => {
  const { archive } = await fixture();
  const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const styles = `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Waterline"><w:name w:val="Waterline"/><w:next w:val="Lettermark"/></w:style><w:style w:type="character" w:styleId="Lettermark"><w:name w:val="Lettermark"/></w:style></w:styles>`;
  const staged = { ...archive, members: archive.members.map(member => member.name === "word/styles.xml" ? { ...member, bytes: new TextEncoder().encode(styles) } : member) };
  const report = validation.validateDocumentArchive(staged);
  expect(report.valid).toBe(false);
  expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: "style-next-type", part: "/word/styles.xml" }));
});

it("keeps repeated-run edits unpublished when cumulative reparsing exhausts the node ledger", async () => {
  const { archive } = await fixture();
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>' + '<w:r><w:t>x</w:t></w:r>'.repeat(8) + '</w:p><w:sectPr/></w:body></w:document>';
  const staged = { ...archive, members: archive.members.map(member => member.name === "word/document.xml" ? { ...member, bytes: new TextEncoder().encode(xml) } : member) };
  const chunks: Uint8Array[] = [];
  await writeArchive(staged, { async write(bytes) { chunks.push(bytes); } }, { compression: "store", order: "name" }, { limits, signal });
  const volume = Volume.fromJSON({ "/input.docx": Buffer.concat(chunks), "/sentinel": "Keep original" });
  const before = volume.toJSON();
  let writes = 0;
  await extractDocumentText(new Uint8Array(volume.readFileSync("/input.docx") as Buffer), { limits, signal, budget: new DocumentBudget({ xmlNodes: 500 }) });
  await expect(replaceDocumentText(new Uint8Array(volume.readFileSync("/input.docx") as Buffer), { find: "x", with: "y", all: true, output: "-" }, {
    limits, signal, budget: new DocumentBudget({ xmlNodes: 500 }), encoding: { compression: "store", order: "name" }, stdout: { async write() { writes++; } }
  })).rejects.toMatchObject({ code: "limit-exceeded" });
  expect(writes).toBe(0);
  expect(volume.toJSON()).toEqual(before);
});
