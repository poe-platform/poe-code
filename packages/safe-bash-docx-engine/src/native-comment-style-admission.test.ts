import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

const ref = (resultHandle: string) => ({ resultHandle });
const context = { ...textContext, timestamp: new Date("2026-01-02T03:04:06Z") };
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const profile of ["wrong-text-type", "wrong-reference-type", "existing-styles", "colliding-ids"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} admits native comment ${profile} atomically; ${kind}; strict=${strict}`, async () => {
  const style = (id: string, name: string, type: string) => `<w:style w:type="${type}" w:styleId="${id}"><w:name w:val="${name}"/><w:rPr><w:b/><w:lang w:val="he-IL"/></w:rPr></w:style>`;
  const definitions = profile === "wrong-text-type" ? style("CommentText", "Comment Text", "character") :
    profile === "wrong-reference-type" ? style("CommentReference", "Comment Reference", "paragraph") :
      profile === "existing-styles" ? style("NativeText", "Comment Text", "paragraph") + style("NativeReference", "Comment Reference", "character") :
        style("CommentText", "User Text", "paragraph") + style("CommentReference", "User Reference", "character");
  const before = readPackage(await textFixture('<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>', {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><!--comment ledger--><?policy keep?></w:comments>` },
    styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}">${style("Normal", "Normal", "paragraph")}${definitions}<!--style ledger--><?policy keep?></w:styles>` }
  }, strict));
  if (kind === "dotx") before.set("[Content_Types].xml", new TextEncoder().encode(
    new TextDecoder().decode(before.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...before].map(([name, bytes]) =>
    ({ name, bytes, directory: false, modified: context.timestamp })) },
  { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, context);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), reject = profile.startsWith("wrong-"), operations = [
    { operation: "model.document.Document.comments.get", receiver: ref("document"), arguments: {}, resultHandle: "comments" },
    { operation: "model.comments.Comments.add_comment.call", receiver: ref("comments"), arguments: { text: "one\n\né 日本 עברית 🌊" } }
  ], sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  if (route === "model") {
    const doc = await api.Document(input, context), normal = doc.styles.at("Normal"), normalBytes = normal.element.serialize(), comments = doc.comments;
    if (reject) {
      expect(() => comments.add_comment("one\n\né 日本 עברית 🌊")).toThrow(api.InputTypeError);
      expect(comments.length).toBe(0); expect(normal.element.serialize()).toEqual(normalBytes);
      expect(doc.styles.length).toBe(2);
    } else comments.add_comment("one\n\né 日本 עברית 🌊");
    await doc.save(sink);
  } else if (route === "sdk") {
    if (reject) {
      await expect(api.applyStyleModelBatch(input, { version: 1, operations }, context)).rejects.toMatchObject({ code: "usage", operationIndex: 1 });
      expect(volume.readFileSync("/out")).toHaveLength(0); volume.writeFileSync("/out", input);
    } else await (await api.applyStyleModelBatch(input, { version: 1, operations }, context)).save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --timestamp 2026-01-02T03:04:06Z --output /out --force --json`);
      expect(r.exitCode, r.stdout + r.stderr).toBe(reject ? 2 : 0);
      if (reject) {
        const envelope = JSON.parse(r.stdout); expect(envelope.errors[0]).toMatchObject({ code: "usage", operationIndex: 1 });
        expect(envelope.affected).toBe(0); expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");
      }
      volume.writeFileSync("/out", reject ? input : await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), saved = readPackage(output); assertPackageLinks(saved);
  for (const [name, bytes] of before) if (reject || name !== "word/comments.xml" && name !== "word/styles.xml") expect(saved.get(name), name).toEqual(bytes);
  if (!reject) {
    const doc = await api.Document(output, context), comment = doc.comments.get(0)!;
    expect(comment.paragraphs.map(para => para.text)).toEqual(["one", "", "é 日本 עברית 🌊"]);
    expect(comment.paragraphs.every(para => para.style?.equals(doc.styles.at("Comment Text")))).toBe(true);
    expect(comment.paragraphs[0]!.runs[0]!.style?.equals(doc.styles.at("Comment Reference"))).toBe(true);
    expect(comment.paragraphs[0]!.runs[0]!.element.children.map(node => node.localName)).toEqual(["rPr", "annotationRef"]);
    const original = await api.Document(input, context);
    for (const owned of original.styles) expect(doc.styles.at(owned.name!).element.serialize()).toEqual(owned.element.serialize());
    if (profile === "existing-styles") expect(saved.get("word/styles.xml")).toEqual(before.get("word/styles.xml"));
    else { expect(doc.styles.at("Comment Text").style_id).not.toBe("CommentText"); expect(doc.styles.at("Comment Reference").style_id).not.toBe("CommentReference"); }
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
