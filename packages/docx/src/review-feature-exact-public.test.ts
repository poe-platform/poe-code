import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

const timestamp = "2026-03-04T05:06:07Z";
const enc = (value: string) => new TextEncoder().encode(value);
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const stringFields = { author: "Coastal creator", category: "Archive", comments: "Original description", content_status: "DRAFT", identifier: "coast-23", keywords: "sea; shore", language: "en-GB", last_modified_by: "Archivist", subject: "Shore survey", title: "Coastal record", version: "2.3" };
const dateFields = { created: "2013-06-15T12:34:56.000Z", last_printed: "2014-06-16T13:35:57.000Z", modified: "2015-07-17T14:36:58.000Z" };
const fields = { ...stringFields, ...dateFields, revision: 9 };
const changed: Record<string, string | number> = { ...Object.fromEntries(Object.entries(stringFields).map(([key, value]) => [key, value + " revised"])), created: "2020-02-29T01:02:03.000Z", last_printed: "2021-04-30T02:03:04.000Z", modified: "2022-05-31T03:04:05.000Z", revision: 12 };
const rows = [1637, 1657, 1658, 1659, 1660, 1661, 1662, 1663, 1664, 1665, 1666, 1667, 1668, 1669, 1670, 1671, 1672, 1673];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const row of rows) for (const route of ["model", "sdk", "cli"] as const)
it(`exact review feature R${row}; strict=${strict}; kind=${kind}; route=${route}`, async () => {
  const hasComments = row === 1637 || row === 1657 || row >= 1659 && row <= 1662;
  const four = row >= 1660 && row <= 1662;
  const hasSettings = row === 1666 || row >= 1668;
  const flag = [1668, 1670, 1671].includes(row);
  const initial = await textFixture('<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Retained海🌊</w:t></w:r></w:p>', {
    ...(hasComments ? { comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}">${four ? [0, 1, 2, 3].map(id => `<w:comment w:id="${id}" w:author="Archive"><w:p><w:r><w:t>Original note ${id}</w:t></w:r></w:p></w:comment>`).join("") : ""}<!--retain--><?audit comments?></w:comments>` } } : {}),
    ...(hasSettings ? { settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}"><w:compat/>${flag ? "<w:evenAndOddHeaders/>" : ""}<!--retain--><?audit settings?></w:settings>` } } : {})
  }, strict, { kind });
  const parts = readPackage(initial);
  if (row === 1663 || row === 1664) {
    const cp = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties", dc = "http://purl.org/dc/elements/1.1/", dt = "http://purl.org/dc/terms/";
    const tags: Record<string, string> = { author: "dc:creator", category: "cp:category", comments: "dc:description", content_status: "cp:contentStatus", identifier: "dc:identifier", keywords: "cp:keywords", language: "dc:language", last_modified_by: "cp:lastModifiedBy", subject: "dc:subject", title: "dc:title", version: "cp:version", created: "dcterms:created", modified: "dcterms:modified", last_printed: "cp:lastPrinted", revision: "cp:revision" };
    parts.set("metadata/core.xml", enc(`<cp:coreProperties xmlns:cp="${cp}" xmlns:dc="${dc}" xmlns:dcterms="${dt}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><!--retain-->${Object.entries(fields).map(([key, value]) => `<${tags[key]}${key === "created" || key === "modified" ? ' xsi:type="dcterms:W3CDTF"' : ""}>${value}</${tags[key]}>`).join("")}<?audit core?></cp:coreProperties>`));
    const types = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!);
    types.insertChildren(types.root, '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/metadata/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'); parts.set("[Content_Types].xml", types.serialize());
    const edges = new api.DocumentXmlEditor(parts.get("_rels/.rels")!);
    edges.insertChildren(edges.root, '<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="Core" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="metadata/core.xml"/>'); parts.set("_rels/.rels", edges.serialize());
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  const context = { ...textContext, timestamp: new Date(timestamp), author: "Archivist", encoding: { order: "input", compression: "store" } as const };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const operations: Record<string, unknown>[] = [];
  const add = (operation: string, receiver: ReturnType<typeof ref>, args: Record<string, unknown> = {}, resultHandle?: string) => operations.push({ operation, receiver, arguments: args, ...(resultHandle ? { resultHandle } : {}) });
  const observed: unknown[] = [];
  if (row === 1637) {
    add("model.document.Document.paragraphs.get", ref("document"), {}, "paragraphs");
    add("model.text.paragraph.Paragraph.runs.get", ref("paragraphs", 0), {}, "runs");
    add("model.document.Document.add_comment.call", ref("document"), { runs: ref("runs", 0), text: "Original anchored note", author: "Coastal reviewer", initials: "CR" }, "comment");
    for (const member of ["text", "author", "initials", "timestamp"]) add(`model.comments.Comment.${member}.get`, ref("comment"));
  } else if (row <= 1662) {
    add("model.document.Document.comments.get", ref("document"), {}, "comments");
    if (row === 1659 || row === 1660) add("model.comments.Comments.__len__.get", ref("comments"));
    if (row === 1661) add("model.comments.Comments.__iter__.call", ref("comments"));
    if (row === 1662) { add("model.comments.Comments.get.call", ref("comments"), { commentId: 2 }, "comment"); add("model.comments.Comment.comment_id.get", ref("comment")); }
  } else if (row <= 1665) {
    add("model.document.Document.core_properties.get", ref("document"), {}, "core");
    if (row === 1664) for (const [key, value] of Object.entries(changed)) add(`model.opc.coreprops.CoreProperties.${key}.set`, ref("core"), { value });
    for (const key of row === 1665 ? ["title", "revision", "modified", "last_modified_by"] : Object.keys(fields)) add(`model.opc.coreprops.CoreProperties.${key}.get`, ref("core"));
  } else {
    add("model.document.Document.settings.get", ref("document"), {}, "settings");
    if (row >= 1670) add("model.settings.Settings.odd_and_even_pages_header_footer.set", ref("settings"), { value: row === 1670 || row === 1672 });
    if (row >= 1668) add("model.settings.Settings.odd_and_even_pages_header_footer.get", ref("settings"));
  }
  const observe = (values: unknown[]) => {
    if (row === 1637) { expect(values[2]).toMatchObject({ type: "Comment" }); expect(values.slice(-4)).toEqual(["Original anchored note", "Coastal reviewer", "CR", new Date(timestamp).toISOString()]); }
    else if (row === 1657 || row === 1658) expect(values[0]).toMatchObject({ type: "Comments" });
    else if (row === 1659 || row === 1660) expect(values.at(-1)).toBe(four ? 4 : 0);
    else if (row === 1661) expect(values.at(-1)).toMatchObject(Array.from({ length: 4 }, () => ({ type: "Comment" })));
    else if (row === 1662) { expect(values.at(-2)).toMatchObject({ type: "Comment" }); expect(values.at(-1)).toBe(2); }
    else if (row === 1663 || row === 1664) { expect(values[0]).toMatchObject({ type: "CoreProperties" }); expect(values.slice(-Object.keys(fields).length)).toEqual(Object.keys(fields).map(key => (row === 1664 ? changed : fields)[key as keyof typeof fields])); }
    else if (row === 1665) expect(values.slice(-4)).toEqual(["Document", 1, new Date(timestamp).toISOString(), "Archivist"]);
    else if (row === 1666 || row === 1667) expect(values[0]).toMatchObject({ type: "Settings" });
    else expect(values.at(-1)).toBe(row >= 1670 ? row === 1670 || row === 1672 : flag);
  };
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const document = await api.Document(input, context);
    if (row === 1637) { const comment = document.add_comment(document.paragraphs[0]!.runs[0]!, "Original anchored note", "Coastal reviewer", "CR"); expect(comment).toBeInstanceOf(api.Comment); expect([comment.text, comment.author, comment.initials, comment.timestamp?.toISOString()]).toEqual(["Original anchored note", "Coastal reviewer", "CR", new Date(timestamp).toISOString()]); }
    else if (row <= 1662) { const comments = document.comments; expect(comments).toBeInstanceOf(api.Comments); if (row === 1659 || row === 1660) expect(comments.length).toBe(four ? 4 : 0); if (row === 1661) { const items = [...comments]; expect(items).toHaveLength(4); expect(items.every(item => item instanceof api.Comment)).toBe(true); expect(items.map(item => item.comment_id)).toEqual([0, 1, 2, 3]); } if (row === 1662) { expect(comments.get(2)).toBeInstanceOf(api.Comment); expect(comments.get(2)!.comment_id).toBe(2); } }
    else if (row <= 1665) { const core = document.core_properties; expect(core).toBeInstanceOf(api.CoreProperties); if (row === 1664) for (const [key, value] of Object.entries(changed)) { const typed = core as unknown as Record<string, unknown>; typed[key] = key in dateFields ? new Date(value) : value; } const expected = row === 1665 ? { title: "Document", revision: 1, modified: new Date(timestamp).toISOString(), last_modified_by: "Archivist" } : row === 1664 ? changed : fields; for (const [key, value] of Object.entries(expected)) { const actual = (core as unknown as Record<string, unknown>)[key]; expect(actual instanceof Date ? actual.toISOString() : actual, key).toBe(value); } }
    else { const settings = document.settings; expect(settings).toBeInstanceOf(api.Settings); if (row >= 1670) settings.odd_and_even_pages_header_footer = row === 1670 || row === 1672; if (row >= 1668) expect(settings.odd_and_even_pages_header_footer).toBe(row >= 1670 ? row === 1670 || row === 1672 : flag); }
    await document.save(sink);
  } else if (route === "sdk") {
    const result = await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-", timestamp, author: "Archivist" }, { ...context, stdout: sink });
    observed.push(...result.results.map(result => result.data)); observe(observed);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", enc("Retained destination")); await fs.writeFile("/operations", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try { const result = await shell.exec(`docx batch /input --ops-file /operations --timestamp ${timestamp} --author Archivist --output /destination --force --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); const data = JSON.parse(result.stdout); expect(data).toMatchObject({ ok: true, errors: [] }); observe(data.data.results.map((item: { data: unknown }) => item.data)); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/output", await fs.readFile("/destination")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output); assertPackageLinks(saved);
  const dirty = new Set([...(row === 1637 ? ["word/document.xml", "word/comments.xml", "word/styles.xml", "[Content_Types].xml", "word/_rels/document.xml.rels"] : []), ...([1658, 1667].includes(row) ? ["[Content_Types].xml", "word/_rels/document.xml.rels"] : []), ...(row === 1665 ? ["[Content_Types].xml", "_rels/.rels"] : []), ...(row >= 1670 ? ["word/settings.xml"] : []), ...(row === 1664 ? ["metadata/core.xml"] : [])]);
  for (const [name, bytes] of parts) if (!dirty.has(name)) expect(saved.get(name), name).toEqual(bytes);
  for (const name of ["word/comments.xml", "word/settings.xml", "metadata/core.xml"]) if (parts.has(name)) { expect(new TextDecoder().decode(saved.get(name))).toContain("<!--retain-->"); expect(new TextDecoder().decode(saved.get(name))).toContain("<?audit"); }
  if (row !== 1637) expect(saved.get("word/document.xml")).toEqual(parts.get("word/document.xml"));
  if ([1657, 1659, 1660, 1661, 1662, 1663, 1666, 1668, 1669].includes(row)) expect(output).toEqual(input);
  const reopened = await api.Document(output, context);
  if (row === 1637) { expect(reopened.comments.get(0)).toMatchObject({ text: "Original anchored note", author: "Coastal reviewer", initials: "CR" }); expect(reopened.paragraphs[0]!.text).toBe("Retained海🌊"); }
  if (row === 1664) for (const [key, value] of Object.entries(changed)) { const actual = (reopened.core_properties as unknown as Record<string, unknown>)[key]; expect(actual instanceof Date ? actual.toISOString() : actual, key).toBe(value); }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
