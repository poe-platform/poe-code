import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { expect, it } from "vitest";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { encodeWholeXmlFixture } from "../tests/fixtures/whole-xml-codec.js";

const compiled = await compiledPublicRuntime;
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const runtime of ["source", "compiled"] as const)
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf8bom", "utf16le", "utf16be"] as const)
for (const shape of ["ignored-property", "processed-property", "fallback-property", "run-attribute"] as const)
for (const remaining of [0, 1]) for (const route of ["sdk", "cli"] as const)
it(`ordered comment anchor refuses opaque ownership before allocation; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; shape=${shape}; remaining=${remaining}; route=${route}`, async () => {
  const api = runtime === "source" ? source : compiled;
  const properties = shape === "ignored-property" ? '<w:rPr><w:i/><o:leaf/></w:rPr>'
    : shape === "processed-property" ? '<w:rPr><o:carrier><w:i/></o:carrier></w:rPr>'
    : shape === "fallback-property" ? '<w:rPr><mc:AlternateContent><mc:Choice Requires="o"><o:leaf/></mc:Choice><mc:Fallback><w:i/></mc:Fallback></mc:AlternateContent></w:rPr>' : "";
  const input = await encodeWholeXmlFixture(await textFixture(`<w:p xmlns:o="urn:original:anchor-preflight" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="o" mc:ProcessContent="o:carrier"><w:r${shape === "run-attribute" ? ' o:stored="Retained海🌊"' : ""}>${properties}<w:t>Coastal anchor</w:t></w:r></w:p>`, {}, strict, { kind }), codec);
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" },
    { operation: "model.document.Document.add_comment.call", receiver: ref("document"), arguments: { runs: ref("runs", 0), text: "Unsafe opaque note", author: "" } }
  ];
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "", "/destination": "Retained destination" });
  if (route === "sdk") {
    await expect(api.executeDocumentBatch(input, { version: 1, operations }, { output: "-", timestamp: "2026-03-04T05:06:07Z" }, { ...textContext, encoding: { order: "input", compression: "store" }, budget: new api.DocumentBudget({ insertedNodes: remaining }), stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(memory.statSync("/output").size).toBe(0);
  } else {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", input);
    await fs.writeFile("/destination", new TextEncoder().encode("Retained destination"));
    await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-file /operations --timestamp 2026-03-04T05:06:07Z --output /destination --force --json --limit insertedNodes=${remaining}`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit", operationIndex: 2 }] });
      expect(await fs.readFile("/input")).toEqual(input);
      expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("Retained destination");
    } finally { await shell.dispose(); }
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
  expect(memory.readFileSync("/destination", "utf8")).toBe("Retained destination");
});
