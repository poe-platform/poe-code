import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const context = { ...textContext, timestamp: new Date("2026-01-02T03:04:06Z") };
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const method of ["add", "mark"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} retains scoped native Comment Reference owner when ${method}ing an anchor; ${kind}; strict=${strict}`, async () => {
  const before = readPackage(await textFixture('<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Retain é 日本 עברית 🌊</w:t></w:r><!--body retained--><?policy keep?></w:p>', {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="42" w:author="Original"><w:p><w:r><w:t>Original note</w:t></w:r></w:p></w:comment><!--comments retained--></w:comments>` },
    styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="NativeText"><w:name w:val="Comment Text"/></w:style><w:style w:type="character" w:styleId="NativeReference"><w:name w:val="Comment Reference"/><w:rPr><w:i/><w:lang w:val="he-IL"/></w:rPr></w:style><!--styles retained--><?policy keep?></w:styles>` }
  }, strict));
  if (kind === "dotx") before.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(before.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...before].map(([name, bytes]) => ({ name, bytes, directory: false, modified: context.timestamp })) },
    { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, context);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" },
    method === "add" ? { operation: "model.document.Document.add_comment.call", receiver: ref("document"), arguments: { runs: ref("runs", 0), text: "New note" } } :
      { operation: "model.text.run.Run.mark_comment_range.call", receiver: ref("runs", 0), arguments: { lastRun: ref("runs", 0), commentId: 42 } }
  ], sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  if (route === "model") {
    const doc = await api.Document(input, context), run = doc.paragraphs[0]!.runs[0]!;
    if (method === "add") doc.add_comment(run, "New note"); else run.mark_comment_range(run, 42);
    await doc.save(sink);
  } else if (route === "sdk") await (await api.applyStyleModelBatch(input, { version: 1, operations }, context)).save(sink);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try { const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --timestamp 2026-01-02T03:04:06Z --output /out --json`);
      expect(r.exitCode, r.stdout + r.stderr).toBe(0); volume.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), saved = readPackage(output); assertPackageLinks(saved);
  for (const [name, bytes] of before) if (name !== "word/document.xml" && !(method === "add" && name === "word/comments.xml")) expect(saved.get(name), name).toEqual(bytes);
  const doc = await api.Document(output, context), paragraph = doc.paragraphs[0]!, reference = paragraph.runs[1]!;
  expect(reference.style?.equals(doc.styles.at("Comment Reference"))).toBe(true);
  expect(reference.style?.style_id).toBe("NativeReference"); expect(reference.element.children.map(node => node.localName)).toEqual(["rPr", "commentReference"]);
  expect(paragraph.runs[0]!.bold).toBe(true); expect(paragraph.paragraph_format.keep_with_next).toBe(true);
  expect(paragraph.text).toBe("Retain é 日本 עברית 🌊");
  const xml = new TextDecoder().decode(saved.get("word/document.xml")); expect(xml).toContain("<!--body retained-->"); expect(xml).toContain("<?policy keep?>");
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
