import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

const replacement = "\u2067日本 אב\u2069 e\u0323\u0301 𠀀";
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const fragment of ["preceding_paragraph_fragment", "following_paragraph_fragment"] as const)
for (const action of ["text", "clear", "add_run"] as const) for (const route of ["model", "sdk", "cli"] as const)
it(`${route} ${action} changes only detached ${fragment}; ${kind}; strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Before</w:t><w:lastRenderedPageBreak/><w:t>After</w:t></w:r><!--retain--><?policy keep?></w:p><w:p><w:r><w:t>Unselected</w:t></w:r></w:p>', {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer);
  const original = fragment === "preceding_paragraph_fragment" ? "Before" : "After";
  const expected = action === "text" ? replacement : action === "clear" ? "" : original + replacement;
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.rendered_page_breaks.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "breaks" },
    { operation: `model.text.pagebreak.RenderedPageBreak.${fragment}.get`, receiver: ref("breaks", 0), arguments: {}, resultHandle: "fragment" },
    { operation: `model.text.paragraph.Paragraph.${action}.${action === "text" ? "set" : "call"}`, receiver: ref("fragment"), arguments: action === "clear" ? {} : action === "text" ? { value: replacement } : { text: replacement } },
    { operation: "model.text.paragraph.Paragraph.text.get", receiver: ref("fragment"), arguments: {} },
    { operation: "model.text.paragraph.Paragraph.text.get", receiver: ref("paragraphs", 0), arguments: {} }
  ];
  const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  if (route === "model") {
    const doc = await api.Document(input, textContext), detached = doc.paragraphs[0]!.rendered_page_breaks[0]![fragment]!;
    expect(detached.text).toBe(original);
    if (action === "text") detached.text = replacement;
    else if (action === "clear") detached.clear();
    else detached.add_run(replacement);
    expect(detached.text).toBe(expected);
    expect(detached.paragraph_format.keep_with_next).toBe(true);
    expect(doc.paragraphs[0]!.text).toBe("BeforeAfter");
    await doc.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    expect(result.results.slice(-2).map(r => r.value)).toEqual([expected, "BeforeAfter"]);
    await result.save(sink);
  } else {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", input);
    await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /out --force --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).data.results.slice(-2).map((r: { data: unknown }) => r.data)).toEqual([expected, "BeforeAfter"]);
      expect(await fs.readFile("/input")).toEqual(input);
      volume.writeFileSync("/out", await fs.readFile("/out"));
    } finally { await shell.dispose(); }
  }
  const saved = readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer));
  assertPackageLinks(saved);
  expect(saved).toEqual(parts);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
