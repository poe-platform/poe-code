import { beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import type * as api from "./index.js";
import { readPackage } from "../tests/assertions.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

let runtime: typeof api;
beforeAll(async () => {
  const bundle = await build({
    entryPoints: [new URL("./index.ts", import.meta.url).pathname],
    bundle: true, platform: "browser", conditions: ["workerd", "worker", "browser"],
    format: "esm", target: "es2022", write: false
  });
  runtime = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.contents).toString("base64")}`) as typeof api;
});

for (const strict of [false, true]) for (const route of ["sdk", "cli"])
it(`bundled ${route} model returns use declared types regardless of constructor renaming; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:rPr><w:color w:val="112233"/></w:rPr><w:t>Before 日本</w:t><w:lastRenderedPageBreak/><w:t>After עברית</w:t></w:r><w:hyperlink w:anchor="Inert"><w:r><w:t>Label</w:t></w:r></w:hyperlink></w:p>', {}, strict);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/destination": "original", "/out": "" });
  const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
  const batch = { version: 1, operations: [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" },
    { operation: "model.text.run.Run.font.get", receiver: ref("runs", 0), arguments: {}, resultHandle: "font" },
    { operation: "model.text.run.Font.color.get", receiver: ref("font"), arguments: {} },
    { operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "format" },
    { operation: "model.text.parfmt.ParagraphFormat.tab_stops.get", receiver: ref("format"), arguments: {} },
    { operation: "model.text.paragraph.Paragraph.hyperlinks.get", receiver: ref("paragraphs", 0), arguments: {} },
    { operation: "model.text.paragraph.Paragraph.rendered_page_breaks.get", receiver: ref("paragraphs", 0), arguments: {} }
  ] };
  let values: unknown[], output: Uint8Array;
  if (route === "sdk") {
    const result = await runtime.applyStyleModelBatch(new Uint8Array(volume.readFileSync("/input") as Buffer), batch, textContext);
    values = result.results.map(r => r.value);
    await result.save({ async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } });
    output = new Uint8Array(volume.readFileSync("/out") as Buffer);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", new Uint8Array(volume.readFileSync("/input") as Buffer)); await fs.writeFile("/destination", volume.readFileSync("/destination") as Buffer);
    const shell = new Shell({ fs }).use(docxCommands({ engine: runtime.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch)}' --output /result --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const envelope = JSON.parse(result.stdout) as { affected: number; data: { publication: { changed: boolean }; results: { data: unknown }[] } };
      expect(envelope.affected).toBe(1); expect(envelope.data.publication.changed).toBe(true);
      output = await fs.readFile("/result");
      values = envelope.data.results.map(r => r.data);
      expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/destination")).toEqual(new Uint8Array(volume.readFileSync("/destination") as Buffer));
    } finally { await shell.dispose(); }
  }
  const kinds = values.map(v => Array.isArray(v) ? v.map((item: { type: string }) => item.type) : (v as { type: string }).type);
  expect(kinds).toEqual([["Paragraph"], ["Run"], "Font", "ColorFormat", "ParagraphFormat", "TabStops", ["Hyperlink"], ["RenderedPageBreak"]]);
  const original = readPackage(input), saved = readPackage(output);
  for (const [name, bytes] of original) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  const doc = await runtime.Document(output, textContext);
  expect(new runtime.DocumentXmlEditor(doc.paragraphs[0]!.element.serialize()).root.children[0]!.localName).toBe("pPr");
  expect(doc.paragraphs[0]!.rendered_page_breaks).toHaveLength(1);
  expect(doc.paragraphs[0]).toBeInstanceOf(runtime.Paragraph); expect(doc.paragraphs[0]!.runs[0]).toBeInstanceOf(runtime.Run);
  expect(doc.paragraphs[0]!.text).toBe("Before 日本After עבריתLabel");
  expect(new Uint8Array(volume.readFileSync("/input") as Buffer)).toEqual(input); expect(volume.readFileSync("/destination", "utf8")).toBe("original");
});
