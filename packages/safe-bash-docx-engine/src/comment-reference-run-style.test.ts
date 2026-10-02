import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage } from "../tests/assertions.js";
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const method of ["mark", "add"] as const)
for (const route of (method === "mark" ? ["model", "model-sdk", "model-cli"] : ["model", "model-sdk", "model-cli", "sdk", "cli"]) as readonly string[])
it(`${route} retains the native character style of the ${method}ed comment-reference run; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>referenced text</w:t></w:r><!--retain--><?audit keep?></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="character" w:styleId="CommentReference"><w:name w:val="Comment Reference"/><w:rPr><w:i/></w:rPr></w:style><!--styles--></w:styles>` }, comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="42" w:author="Survey"><w:p><w:r><w:t>Original annotation</w:t></w:r></w:p></w:comment></w:comments>` } }, strict), memory = Volume.fromJSON({ "/out": "" }), context = { ...textContext, timestamp: new Date("2026-01-02T03:04:05Z"), encoding: { order: "input" as const, compression: "store" as const } }, sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } }, id = method === "mark" ? 42 : 43;
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" },
    method === "mark" ? { operation: "model.text.run.Run.mark_comment_range.call", receiver: ref("runs", 0), arguments: { lastRun: ref("runs", 0), commentId: 42 } } : { operation: "model.document.Document.add_comment.call", receiver: ref("document"), arguments: { runs: ref("runs", 0), text: "Additional note", author: "Survey" } }
  ];
  const locations = await api.openDocumentLocations(input, context), select = locations.range(locations.at("paragraph", 1).token, 0, 15).token;
  if (route === "model") { const doc = await api.Document(input, context), run = doc.paragraphs[0]!.runs[0]!; if (method === "mark") run.mark_comment_range(run, 42); else expect(doc.add_comment(run, "Additional note", "Survey").comment_id).toBe(43); await doc.save(sink); }
  else if (route === "model-sdk") { const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, context); await batch.save(sink); }
  else if (route === "sdk") await api.editDocumentComments(input, { operation: "comments.add", options: { select, text: "Additional note", author: "Survey", timestamp: "2026-01-02T03:04:05Z", output: "-" } }, { ...context, stdout: sink });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const command = route === "model-cli" ? `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --timestamp 2026-01-02T03:04:05Z --output /out --json` : `docx comments add /input --select '${select}' --text 'Additional note' --author Survey --timestamp 2026-01-02T03:04:05Z --output /out --json`; const r = await shell.exec(command); expect(r.exitCode, r.stdout + r.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); } }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after);
  for (const [name, bytes] of before) if (name !== "word/document.xml" && !(method === "add" && (name === "word/comments.xml" || (route.startsWith("model") && name === "word/styles.xml")))) expect(after.get(name), name).toEqual(bytes);
  const doc = await api.Document(output, context), p = doc.paragraphs[0]!, reference = p.runs[1]!;
  expect(doc.styles.at("Comment Reference").element.serialize()).toEqual((await api.Document(input, context)).styles.at("Comment Reference").element.serialize());
  if (method === "add" && route.startsWith("model")) { expect(doc.styles.default(api.WD_STYLE_TYPE.PARAGRAPH)).toBeNull(); expect(doc.styles.at("Comment Text").type).toBe(api.WD_STYLE_TYPE.PARAGRAPH); expect(doc.comments.get(id)!.paragraphs[0]!.style?.equals(doc.styles.at("Comment Text"))).toBe(true); expect(doc.styles.length).toBe(2); }
  expect(p.runs[0]!.text).toBe("referenced text"); expect(p.runs[0]!.bold).toBe(true); expect(p.paragraph_format.keep_with_next).toBe(true);
  expect(reference.element.children.map(n => n.localName)).toEqual(["rPr", "commentReference"]);
  expect(reference.style?.equals(doc.styles.at("Comment Reference"))).toBe(true); expect(reference.style?.style_id).toBe("CommentReference");
  expect(reference.element.children[0]!.children.map(n => n.localName)).toEqual(["rStyle"]);
  expect([...reference.element.children[1]!.attributes].find(([name]) => name.localName === "id")?.[1]).toBe(String(id));
  for (const token of ["<!--retain-->", "<?audit keep?>"]) expect(new TextDecoder().decode(after.get("word/document.xml")).split(token)).toHaveLength(2);
});
