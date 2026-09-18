import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { readPackage } from "../tests/assertions.js";

const enc = (text: string) => new TextEncoder().encode(text);
const ref = (resultHandle: string) => ({ resultHandle });
type Data = { item: { text: string; location: api.Location; properties: { name: string; type: string; value: unknown; writable: boolean; cached: boolean }[]; references: unknown[] } };
const sdk = (resource: "paragraphs" | "runs") => (api as unknown as Record<string, (input: Uint8Array, options: object, context: api.ArchiveContext) => Promise<Data>>)[resource === "paragraphs" ? "inspectDocumentParagraph" : "inspectDocumentRun"]!;

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const resource of ["paragraphs", "runs"] as const) for (const route of ["sdk", "shell"] as const) {
  it(`${route} retains false, zero and inherited absence in ${resource} data; strict=${strict}; kind=${kind}`, async () => {
    const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind,
      '<w:p><w:pPr><w:keepNext w:val="false"/><w:spacing w:before="0"/></w:pPr><w:r><w:rPr><w:b w:val="false"/></w:rPr><w:t>Coast</w:t><w:tab/><w:t>line</w:t><w:br/><w:t>end</w:t></w:r></w:p>');
    let data: Data;
    if (route === "sdk") data = await sdk(resource)(input, { paragraph: 1, ...(resource === "runs" ? { run: 1 } : {}) }, textContext);
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/source", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try { const result = await shell.exec(`docx ${resource} get /source --paragraph 1${resource === "runs" ? " --run 1" : ""} --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); const envelope = JSON.parse(result.stdout); data = envelope.data; expect(envelope).toMatchObject({ affected: 0, errors: [], locations: [data.item.location] }); expect(await fs.readFile("/source")).toEqual(input); }
      finally { await shell.dispose(); }
    }
    expect(data.item.text).toBe("Coast\tline\nend");
    expect(data.item.properties).toContainEqual({ name: resource === "runs" ? "bold" : "keepWithNext", type: "boolean", value: false, writable: true, cached: false });
    expect(data.item.properties).toContainEqual({ name: resource === "runs" ? "italic" : "keepTogether", type: "boolean", value: null, writable: true, cached: false });
    if (resource === "paragraphs") expect(data.item.properties).toContainEqual({ name: "spaceBefore", type: "number", value: 0, writable: true, cached: false });
    expect(data.item.references).toEqual([]);
  });

  it(`${route} enforces ${resource} missing, absent-selector, wrong-kind and stale selections; strict=${strict}; kind=${kind}`, async () => {
    const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>One</w:t></w:r><w:r><w:t>Two</w:t></w:r></w:p><w:p><w:r><w:t>Three</w:t></w:r></w:p>');
    const locations = await api.openDocumentLocations(input, textContext);
    const other = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Other</w:t></w:r></w:p>');
    const stale = (await api.openDocumentLocations(other.input, textContext)).list(resource === "paragraphs" ? "paragraph" : "run", { scope: "body" })[0]!.token;
    const cases = [
      { options: { paragraph: 99, ...(resource === "runs" ? { run: 1 } : {}) }, code: "missing-selection" },
      { options: resource === "runs" ? { paragraph: 1 } : {}, code: "usage" },
      { options: { select: locations.list(resource === "runs" ? "paragraph" : "run", { scope: "body" })[0]!.token }, code: "missing-selection" },
      { options: { select: stale }, code: "stale-selection" }
    ];
    const fs = new MemoryFileSystem(); await fs.writeFile("/source", input);
    const shell = route === "shell" ? new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })) : undefined;
    try { for (const entry of cases) {
      if (!shell) await expect(sdk(resource)(input, entry.options, textContext)).rejects.toMatchObject({ code: entry.code });
      else { const flags = Object.entries(entry.options).map(([key, value]) => `--${key} ${value}`).join(" "); const result = await shell.exec(`docx ${resource} get /source ${flags} --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(entry.code === "usage" ? 2 : 1); expect(JSON.parse(result.stdout)).toMatchObject({ data: null, affected: 0, errors: [{ code: entry.code }] }); }
    } expect(await fs.readFile("/source")).toEqual(input); } finally { await shell?.dispose(); }
  });
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const resource of ["paragraphs", "runs"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} keeps the selected ${resource} native result handle live across an edit; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Harbor before</w:t></w:r></w:p>');
  const options = { paragraph: 1, ...(resource === "runs" ? { run: 1 } : {}) };
  const operations = [
    { operation: `${resource}.get`, arguments: options, resultHandle: "selected" },
    { operation: resource === "runs" ? "model.text.run.Run.text.set" : "model.text.paragraph.Paragraph.text.set", receiver: ref("selected"), arguments: { value: "Harbor after" } },
    { operation: `${resource}.get`, arguments: options },
    { operation: resource === "runs" ? "model.text.run.Run.text.get" : "model.text.paragraph.Paragraph.text.get", receiver: ref("selected"), arguments: {} }
  ];
  let results: readonly { data: unknown; affected: number }[], output: Uint8Array;
  if (route === "sdk") {
    const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); results = batch.operationResults;
    const memory = Volume.fromJSON({ "/output": "" }); await batch.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } }); output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/source", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /source --ops-file /ops --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); results = JSON.parse(result.stdout).data.results; output = await fs.readFile("/output"); expect(await fs.readFile("/source")).toEqual(input); } finally { await shell.dispose(); }
  }
  expect(results[0]).toMatchObject({ data: { item: { text: "Harbor before", location: { value: { generation: 0 } } } }, affected: 0 });
  expect(results[2]).toMatchObject({ data: { item: { text: "Harbor after", location: { value: { generation: 1 } } } }, affected: 0 });
  expect(results[3]).toMatchObject({ data: "Harbor after", affected: 0 });
  expect(new TextDecoder().decode(readPackage(output).get("word/document.xml"))).toContain("Harbor after");
  for (const [name, bytes] of readPackage(input)) if (name !== "word/document.xml") expect(readPackage(output).get(name), name).toEqual(bytes);
});
