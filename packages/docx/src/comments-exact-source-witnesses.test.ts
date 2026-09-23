import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { commentsSourceCases, commentsSourceBody } from "../tests/fixtures/comments-exact-source.js";
import { readPackage, assertPackageLinks, xmlStructure } from "../tests/assertions.js";

const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const stamp = new Date("2026-01-02T03:04:06Z"), context = { ...textContext, timestamp: stamp };
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const c of commentsSourceCases) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} independently executes exact comments witness R${c.row}; ${kind}; strict=${strict}`, async () => {
  const inputParts = readPackage(await textFixture('<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p><w:sectPr/>', {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><!--comments retained-->${commentsSourceBody(c)}<?policy keep?></w:comments>` },
    styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><!--styles retained--><?policy keep?></w:styles>` }
  }, strict));
  if (kind === "dotx") inputParts.set("[Content_Types].xml", new TextEncoder().encode(
    new TextDecoder().decode(inputParts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...inputParts].map(([name, bytes]) =>
    ({ name, bytes, directory: false, modified: stamp })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } },
  { order: "input", compression: "store" }, context);
  const malformed = [790, 791, 792].includes(c.row);
  const reltype = (strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships") + "/comments";
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), operations: Record<string, unknown>[] = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("main"), arguments: { reltype }, resultHandle: "part" },
    { operation: "model.parts.comments.CommentsPart.comments.get", receiver: ref("part"), arguments: {}, resultHandle: "comments" }
  ];
  if (c.action === "count" || c.action === "iterate") operations.push({
    operation: `model.comments.Comments.${c.action === "count" ? "__len__.get" : "__iter__.call"}`,
    receiver: ref("comments"), arguments: {} });
  else {
    operations.push({ operation: `model.comments.Comments.${c.action === "add" ? "add_comment" : "get"}.call`, receiver: ref("comments"),
      arguments: c.action === "add" ? { ...( "text" in c ? { text: c.text } : {}), ...( "author" in c ? { author: c.author, initials: c.initials } : {}) } : { commentId: "id" in c ? c.id : 42 },
      ...(c.row === 794 ? {} : { resultHandle: "comment" }) });
    if (c.action === "lookup" && c.expected !== null) operations.push({ operation: "model.comments.Comment.comment_id.get", receiver: ref("comment"), arguments: {} });
    if (c.action === "property" || c.action === "text") operations.push({ operation: `model.comments.Comment.${c.action === "property" ? c.field : "text"}.get`, receiver: ref("comment"), arguments: {} });
    if (c.action === "set") operations.push({ operation: `model.comments.Comment.${c.field}.set`, receiver: ref("comment"), arguments: { value: c.value } },
      { operation: `model.comments.Comment.${c.field}.get`, receiver: ref("comment"), arguments: {} });
    if (c.action === "paragraphs") operations.push({ operation: "model.comments.Comment.paragraphs.get", receiver: ref("comment"), arguments: {}, resultHandle: "paragraphs" },
      ...[0, 1].map(index => ({ operation: "model.text.paragraph.Paragraph.text.get", receiver: ref("paragraphs", index), arguments: {} })));
  }
  const observe = (values: unknown[]) => {
    if (c.action === "count" || c.action === "property" || c.action === "text") expect(values.at(-1)).toEqual(c.expected);
    if (c.action === "lookup") {
      if (c.expected === null) expect(values.at(-1)).toBeNull();
      else { expect(values.at(-2)).toMatchObject({ type: "Comment" }); expect(values.at(-1)).toBe(c.expected); }
    }
    if (c.action === "iterate") expect(values.at(-1)).toMatchObject([{ type: "Comment" }, { type: "Comment" }]);
    if (c.action === "paragraphs") expect(values.slice(-2)).toEqual(c.expected);
    if (c.action === "set") expect(values.at(-1)).toBe(c.value);
  };
  const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  if (route === "model") {
    const doc = await api.Document(input, context), part = doc.part.part_related_by(reltype);
    expect(part).toBeInstanceOf(api.CommentsPart);
    if (!(part instanceof api.CommentsPart)) throw new Error("Missing native comments part");
    const comments = part.comments;
    if (c.action === "count") expect(comments.length).toBe(c.expected);
    else if (c.action === "iterate") {
      const iterator = comments[Symbol.iterator]();
      for (let index = 0; index < 2; index++) { const next = iterator.next(); expect(next.done).toBe(false); expect(next.value).toBeInstanceOf(api.Comment); expect(next.value!.part).toBe(doc.part.part_related_by((strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships") + "/comments")); }
      expect(iterator.next()).toEqual({ value: undefined, done: true });
    } else {
      const comment = c.action === "add" ? comments.add_comment("text" in c ? c.text : undefined,
        "author" in c ? c.author : undefined, "initials" in c ? c.initials : undefined) : comments.get("id" in c ? c.id : 42);
      if (c.row === 794) expect(comment).toBeNull();
      else {
        expect(comment).toBeInstanceOf(api.Comment);
        if (!comment) throw new Error("Missing source comment");
        if (c.action === "lookup") expect(comment.comment_id).toBe(c.expected);
        if (c.action === "property") expect(c.field === "timestamp" ? comment.timestamp?.toISOString() : comment[c.field]).toBe(c.expected);
        if (c.action === "text") expect(comment.text).toBe(c.expected);
        if (c.action === "paragraphs") expect(comment.paragraphs.map(para => para.text)).toEqual(c.expected);
        if (c.action === "set") { if (c.field === "author") comment.author = c.value; else comment.initials = c.value; expect(comment[c.field]).toBe(c.value); }
      }
    }
    if (malformed) {
      await expect(doc.save(sink)).rejects.toMatchObject({ code: "invalid-package" });
      expect(volume.readFileSync("/out")).toHaveLength(0); volume.writeFileSync("/out", input);
    } else await doc.save(sink);
  } else if (route === "sdk") {
    const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, context); observe(batch.results.map(result => result.value));
    if (malformed) {
      await expect(batch.save(sink)).rejects.toMatchObject({ code: "invalid-package" });
      expect(volume.readFileSync("/out")).toHaveLength(0); volume.writeFileSync("/out", input);
    } else await batch.save(sink);
  }
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const creating = c.action === "add" || c.action === "set";
      const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --timestamp 2026-01-02T03:04:06Z ${creating ? "--output /out --force" : ""} --json`);
      expect(r.exitCode, r.stdout + r.stderr).toBe(0); observe(JSON.parse(r.stdout).data.results.map((result: { data: unknown }) => result.data));
      volume.writeFileSync("/out", creating ? await fs.readFile("/out") : input); expect(await fs.readFile("/input")).toEqual(input);
      if (!creating) expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");
      if (malformed) {
        const mutation = { version: 1, operations: [{ operation: "model.document.Document.comments.get", receiver: ref("document"), arguments: {} }] };
        const rejected = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(mutation)}' --output /out --force --json`);
        expect(rejected.exitCode).toBe(1); const envelope = JSON.parse(rejected.stdout);
        expect(envelope.errors[0]).toMatchObject({ code: "invalid-package", operationIndex: 0 });
        expect(envelope.affected).toBe(0); expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");
        expect(await fs.readFile("/input")).toEqual(input);
      }
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), saved = readPackage(output); assertPackageLinks(saved);
  for (const [name, bytes] of inputParts) if (!(c.action === "add" && (name === "word/comments.xml" || name === "word/styles.xml") || c.action === "set" && name === "word/comments.xml")) expect(saved.get(name), name).toEqual(bytes);
  for (const name of ["word/comments.xml", "word/styles.xml"]) {
    const text = new TextDecoder().decode(saved.get(name)); expect(text).toContain(`<!--${name.includes("comments") ? "comments" : "styles"} retained-->`); expect(text).toContain("<?policy keep?>");
  }
  const reopened = await api.Document(output, context);
  if (c.action === "add") {
    const comment = reopened.comments.get(0)!; expect(comment.comment_id).toBe(0); expect(comment.author).toBe("author" in c ? c.author : "");
    expect(comment.initials).toBe("initials" in c ? c.initials : ""); expect(comment.timestamp?.toISOString()).toBe(stamp.toISOString());
    expect(comment.paragraphs.map(para => para.text)).toEqual(c.paragraphs);
    expect(comment.paragraphs.every(para => para.style?.equals(reopened.styles.at("Comment Text")))).toBe(true);
    const first = comment.paragraphs[0]!, marker = first.runs[0]; expect(marker).toBeDefined();
    expect(marker!.style?.equals(reopened.styles.at("Comment Reference"))).toBe(true);
    expect(marker!.element.children.map(node => node.localName)).toEqual(["rPr", "annotationRef"]);
    if (c.row === 795) expect(first.runs.length).toBe(1);
    const root = xmlStructure(comment.element.serialize()); expect(root).toBeDefined();
  }
  expect(reopened.paragraphs[0]!.text).toBe("Retain é 日本 עברית 🌊"); expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
