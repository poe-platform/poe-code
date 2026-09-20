import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage } from "../tests/assertions.js";

const cases = [
  { operation: "styles.add", arguments: { name: "New Quay", type: "character" }, kind: "add", id: "Style1" },
  { operation: "styles.set", arguments: { name: "Quay", bold: false }, kind: "set", id: "Quay" },
  { operation: "styles.remove", arguments: { name: "Quay" }, kind: "remove", id: "Quay" },
  { operation: "styles.defaults.set", arguments: { italic: true }, kind: "set", id: "docDefaults" },
  { operation: "styles.latent.add", arguments: { name: "New Fog", hidden: true }, kind: "add", id: "New Fog" },
  { operation: "styles.latent.set", arguments: { name: "Fog", hidden: false }, kind: "set", id: "Fog" },
  { operation: "styles.latent.remove", arguments: { name: "Fog" }, kind: "remove", id: "Fog" },
  { operation: "styles.latent.defaults.set", arguments: { defaultToHidden: false }, kind: "set", id: "latentStyles" },
  { operation: "styles.set", arguments: { name: "Quay", hidden: null }, kind: null, id: null },
  { operation: "styles.latent.defaults.set", arguments: { defaultPriority: null }, kind: null, id: null },
  { operation: "styles.add", arguments: { name: "New Quay", type: "paragraph", defaultForType: true }, kind: "add", id: "Style1", modifiedIds: ["Quay"] },
  { operation: "styles.add", arguments: { name: "New Quay", type: "paragraph", linkedStyle: "Drift", defaultForType: true }, kind: "add", id: "Style1", modifiedIds: ["Quay", "Previous", "Drift"] },
  { operation: "styles.add", arguments: { name: "New Quay", type: "character", linkedStyle: "Quay" }, kind: "add", id: "Style1", modifiedIds: ["Quay"] }
] as const;

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "cli"] as const) for (const dryRun of [false, true])
for (const [index, scenario] of cases.entries())
it(`reports contract publication kinds without changing style result kinds; case=${index}; ${route}; ${kind}; strict=${strict}; dry=${dryRun}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:pPr><w:pStyle w:val="Quay"/></w:pPr><w:r><w:t>Quay 日本 עברית é 🌊</w:t></w:r></w:p>', {
    styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:docDefaults><w:rPrDefault><w:rPr><w:b/></w:rPr></w:rPrDefault></w:docDefaults><w:latentStyles w:defSemiHidden="1"><w:lsdException w:name="Fog" w:semiHidden="1"/></w:latentStyles><w:style w:type="paragraph" w:default="1" w:customStyle="1" w:styleId="Quay"><w:name w:val="Quay"/><w:rPr><w:b/></w:rPr></w:style><w:style w:type="paragraph" w:customStyle="1" w:styleId="Previous"><w:name w:val="Previous"/><w:link w:val="Drift"/></w:style><w:style w:type="character" w:customStyle="1" w:styleId="Drift"><w:name w:val="Drift"/><w:link w:val="Previous"/><w:rPr><w:i/></w:rPr></w:style><!--keep--><?audit keep?></w:styles>` }
  }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), batch = { version: 1, operations: [{ id: "style", operation: scenario.operation, arguments: scenario.arguments }] };
  let data: api.DocumentBatchData;
  if (route === "sdk") {
    data = await api.executeDocumentBatch(input, batch, { output: "-", dryRun }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Keep destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch)}' --output /destination --force ${dryRun ? "--dry-run" : ""} --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); const envelope = JSON.parse(result.stdout);
      expect(envelope).toMatchObject({ version: 1, operation: "batch", ok: true, affected: scenario.kind === null ? 0 : 1 + ("modifiedIds" in scenario ? scenario.modifiedIds.length : 0), errors: [] }); data = envelope.data;
      expect(await fs.readFile("/input")).toEqual(input);
      if (dryRun) expect(await fs.readFile("/destination")).toEqual(new TextEncoder().encode("Keep destination"));
      else memory.writeFileSync("/out", await fs.readFile("/destination"));
    } finally { await shell.dispose(); }
  }
  const expectedIds = scenario.id === null ? [] : [scenario.id, ...("modifiedIds" in scenario ? scenario.modifiedIds : [])];
  const inner = data.results[0]!.data as api.StyleMutationData;
  expect(Object.keys(inner).sort()).toEqual(["changed", "changes", "dryRun", "output"]);
  expect(inner).toMatchObject({ changed: scenario.kind !== null, dryRun: false, output: null });
  expect(inner.changes.map(change => change.id).sort()).toEqual(expectedIds.slice().sort());
  expect(inner.changes.every(change => change.kind === "style")).toBe(true);
  for (const change of inner.changes) expect(Object.keys(change).sort()).toEqual(["id", "kind"]);
  const expectedChanges = inner.changes.map(change => ({ kind: change.id === scenario.id ? scenario.kind : "set", before: null, after: null }));
  expect(data.publication).toMatchObject({ changed: scenario.kind !== null, changes: expectedChanges, dryRun });
  if (dryRun) { expect(data.publication!.output).toBeNull(); expect(memory.readFileSync("/out").length).toBe(0); }
  else {
    const output = new Uint8Array(memory.readFileSync("/out") as Buffer), saved = readPackage(output); assertPackageLinks(saved);
    expect(data.publication!.output?.bytes).toBe(output.length);
    for (const [name, bytes] of parts) if (name !== "word/styles.xml") expect(saved.get(name), name).toEqual(bytes);
    expect(new TextDecoder().decode(saved.get("word/styles.xml"))).toContain("<!--keep--><?audit keep?>");
    if (scenario.kind === null) expect(saved).toEqual(parts);
    expect((await api.Document(output, textContext)).paragraphs[0]!.text).toBe("Quay 日本 עברית é 🌊");
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
