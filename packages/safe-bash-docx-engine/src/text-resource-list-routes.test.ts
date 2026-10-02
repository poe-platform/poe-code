import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

type Data = { items: { kind: string; text: string; location: api.Location; properties: { name: string; value: unknown }[]; references: unknown[]; support: string }[] };
const sdk = (resource: "paragraphs" | "runs") => (api as unknown as Record<string, (input: Uint8Array, options: object, context: api.ArchiveContext) => Promise<Data>>)[resource === "paragraphs" ? "inspectDocumentParagraphs" : "inspectDocumentRuns"]!;

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const carrier of ["direct", "choice", "fallback", "process"] as const) for (const resource of ["paragraphs", "runs"] as const) for (const route of ["model", "sdk", "shell", "sdk-batch", "shell-batch"] as const)
it(`${route} lists stored ${resource} in logical ${carrier} order without mutation; strict=${strict}; kind=${kind}`, async () => {
  const visible = '<w:r><w:rPr><w:b w:val="false"/></w:rPr><w:t>é 日本 עברית 🌊</w:t><w:tab/><w:t>end</w:t></w:r>', hidden = '<w:r><w:t>INACTIVE</w:t></w:r>';
  const content = carrier === "direct" ? visible : carrier === "process" ? `<f:pass>${visible}</f:pass><f:opaque>${hidden}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? visible : hidden}</mc:Choice><mc:Fallback>${carrier === "fallback" ? visible : hidden}</mc:Fallback></mc:AlternateContent>`;
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:list" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:pPr><w:keepNext w:val="false"/><w:spacing w:before="0"/></w:pPr>${content}<w:r><w:t>tail</w:t></w:r><!--keep--><?audit keep?></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p>`);
  const expected = resource === "paragraphs" ? ["é 日本 עברית 🌊\tendtail", "Second"] : ["é 日本 עברית 🌊\tend", "tail", "Second"];
  let data: Data | undefined;
  if (route === "model") {
    const document = await api.Document(input, textContext); expect(resource === "paragraphs" ? document.paragraphs.map(p => p.text) : document.paragraphs.flatMap(p => p.runs.map(r => r.text))).toEqual(expected);
    const memory = Volume.fromJSON({ "/out": "" }); await document.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } }); const before = readPackage(input), after = readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer)); for (const [name, bytes] of before) expect(after.get(name), name).toEqual(bytes);
  } else if (route === "sdk") data = await sdk(resource)(input, {}, textContext);
  else if (route === "sdk-batch") {
    const result = await api.executeDocumentBatch(input, { version: 1, operations: [{ operation: `${resource}.list`, arguments: {} }] }, {}, { ...textContext, encoding: { order: "input", compression: "store" } }); data = result.results[0]!.data as Data; expect(result.results[0]!.affected).toBe(0); expect(result.publication).toBeNull();
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(route === "shell" ? `docx ${resource} list /input --json` : `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations: [{ operation: `${resource}.list`, arguments: {} }] })}' --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); const envelope = JSON.parse(result.stdout); data = route === "shell" ? envelope.data : envelope.data.results[0].data; expect(envelope.affected).toBe(0); expect(await fs.readFile("/input")).toEqual(input); await expect(fs.readFile("/output")).rejects.toThrow(); if (route === "shell") expect(envelope.locations).toEqual(data!.items.map(i => i.location)); } finally { await shell.dispose(); }
  }
  if (data) { expect(data.items.map(i => i.text)).toEqual(expected); expect(data.items.every(i => i.kind === resource && i.support === "read")).toBe(true); expect(data.items[0]!.properties).toContainEqual(expect.objectContaining({ name: resource === "runs" ? "bold" : "keepWithNext", value: false })); expect(data.items[0]!.references).toEqual([]); expect(new Set(data.items.map(i => i.location.token)).size).toBe(expected.length); }
});

for (const strict of [false, true]) for (const resource of ["paragraphs", "runs"] as const) for (const route of ["sdk", "shell", "sdk-batch", "shell-batch"] as const)
it(`${route} supports empty and narrowed ${resource} lists; strict=${strict}`, async () => {
  for (const [body, options, expected] of [["", {}, []], ['<w:p><w:r><w:t>A</w:t></w:r><w:r><w:t>B</w:t></w:r></w:p><w:p><w:r><w:t>C</w:t></w:r></w:p>', { paragraph: 1 }, resource === "paragraphs" ? ["AB"] : ["A", "B"]]] as const) {
    const { input } = await nativeStoryFixture("document.DocumentPart", strict, "docx", body); let data: Data;
    if (route === "sdk") data = await sdk(resource)(input, options, textContext);
    else if (route === "sdk-batch") { const result = await api.executeDocumentBatch(input, { version: 1, operations: [{ operation: `${resource}.list`, arguments: options }] }, {}, { ...textContext, encoding: { order: "input", compression: "store" } }); data = result.results[0]!.data as Data; }
    else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec(route === "shell" ? `docx ${resource} list /input ${"paragraph" in options ? "--paragraph 1 " : ""}--json` : `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations: [{ operation: `${resource}.list`, arguments: options }] })}' --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); data = route === "shell" ? JSON.parse(result.stdout).data : JSON.parse(result.stdout).data.results[0].data; expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); } }
    expect(data.items.map(i => i.text)).toEqual(expected);
  }
});
