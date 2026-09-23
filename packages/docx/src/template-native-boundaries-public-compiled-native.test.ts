import { Volume } from "memfs";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const api = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { textContext as sourceTextContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

// Execute every preserved public boundary against the compiled package runtime.
const textContext = { limits: sourceTextContext.limits, signal: sourceTextContext.signal };

const encode = (value: string) => new TextEncoder().encode(value);
const field = (id: number) => `<w:sdt><w:sdtPr><w:id w:val="${id}"/><w:tag w:val="entry"/><w:alias w:val="Retained field"/><w:text/><w:showingPlcHdr/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>{{entry}}</w:t></w:r></w:sdtContent></w:sdt>`;
const region = (tag: string, blocks: string, id: number) => `<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="${id}"/><w:tag w:val="${tag}"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="${id+1}"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent>${blocks}</w:sdtContent></w:sdt></w:sdtContent></w:sdt>`;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
for (const boundary of ["row-1000", "row-1001", "block-1000", "block-1001", "depth4", "depth5", "depth5-shape", "row-1000-budget", "block-1000-budget"] as const)
describe(`${route} executes native template boundary ${boundary}; ${kind}; strict=${strict}`, () => {
  const fails = boundary.endsWith("1001") || boundary.startsWith("depth5") || boundary.endsWith("budget");
  const rejection = boundary === "depth5" ? "usage" : "limit-exceeded";
  const controller = new AbortController();
  afterAll(() => { controller.abort(); context = undefined; output = undefined; });
  let output: Uint8Array | undefined, input: Uint8Array, before: ReturnType<typeof readPackage>;
  const documentLimits = { retainedBytes: 2147483648, work: 2147483648 };
  const limits = { ...textContext.limits, maxArchiveBytes: 33554432, maxEntryBytes: 16777216, maxTotalBytes: 67108864, maxRetainedBytes: documentLimits.retainedBytes };
  let context: compiledTypes.ArchiveContext & { readonly encoding: { readonly order: "input"; readonly compression: "store" } } | undefined = { ...textContext, signal: controller.signal, budget: new api.DocumentBudget(documentLimits, controller.signal), limits, encoding: { order: "input", compression: "store" } };
  it("publishes or rejects before mutation", async () => {
  if (!context) throw new Error("No admitted invocation context.");
  onTestFinished(() => { if (!output) controller.abort(); });
  let body: string, data: compiledTypes.DocxTemplateRecord | readonly compiledTypes.DocxTemplateRecord[];
  const paragraph = `<w:p>${field(30)}</w:p>`;
  if (boundary.startsWith("depth")) {
    body = paragraph; let record: compiledTypes.DocxTemplateRecord = { values: [{ binding: "entry", value: "Nested leaf 海" }] };
    for (let level = Number(boundary[5]); level > 0; level--) { body = region(`level${level}`, body, level * 100); record = { values: [{ binding: `level${level}`, value: [record] }] }; }
    data = boundary === "depth5-shape" ? [] : record;
  } else {
    const rows = boundary.startsWith("row"), count = Number(boundary.split("-")[1]);
    body = rows ? `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>${region("records", `<w:tr><w:tc>${paragraph}</w:tc></w:tr>`, 10)}</w:tbl>` : region("records", paragraph, 10);
    data = Array.from({ length: count }, (_, index) => ({ values: [{ binding: "entry", value: `Record ${index} 海` }] }));
  }
  input = await textFixture('<w:p><w:r><w:t>Outside {{entry}}</w:t></w:r></w:p><!--retain--><?audit exact?>'+body+'<w:sectPr><w:headerReference w:type="default" r:id="headnotes"/></w:sectPr>', { headnotes: { kind: "header", xml: `<w:hdr xmlns:w="${w}"><w:p>${field(777)}</w:p></w:hdr>` } }, strict, { kind });
  before = readPackage(input);
  const memory = Volume.fromJSON({ "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const operationLimits = boundary.endsWith("budget") ? { limit: [{ name: "retainedBytes" as const, value: 1048576 }] } : {};
  const batch = { version: 1 as const, operations: [{ operation: "template.apply" as const, arguments: { data } }] };
  if (route === "sdk" || route === "sdk-batch") {
    const result = route === "sdk" ? api.applyDocumentTemplate(input, { data, output: "-", ...operationLimits }, { ...context, stdout: sink }) : api.executeDocumentBatch(input, batch, { output: "-", ...operationLimits }, { ...context, stdout: sink });
    if (fails) { await expect(result).rejects.toMatchObject({ code: rejection }); expect(memory.readFileSync("/output")).toHaveLength(0); expect(readPackage(input)).toEqual(before); return; }
    await result; output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", encode("Retained destination")); await fs.writeFile("/data", encode(JSON.stringify(data))); await fs.writeFile("/ops", encode(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits }) }));
    try {
      const command = route === "cli" ? "docx template apply /input --data-file /data --output /output --force --json" : "docx batch /input --ops-file /ops --output /output --force --json";
      const result = await shell.exec(command + (boundary.endsWith("budget") ? " --limit retainedBytes=1048576" : ""), { signal: controller.signal });
      expect(await fs.readFile("/input")).toEqual(input);
      if (fails) { expect(result.exitCode, result.stdout + result.stderr).toBe(rejection === "usage" ? 2 : 4); expect(JSON.parse(result.stdout).errors[0].code).toBe(rejection); expect(await fs.readFile("/output")).toEqual(encode("Retained destination")); return; }
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); output = await fs.readFile("/output");
    } finally { await shell.dispose(); }
  }
  expect(readPackage(input)).toEqual(before);
  });
  if (fails) return;
  it("independently verifies ZIP/XML and every nondirty member", () => {
  expect(output, "Verified publication candidate").toBeDefined();
  if (!output) throw new Error("No verified publication candidate.");
  const saved = readPackage(output, limits); assertPackageLinks(saved, limits.maxEntryBytes); expect([...saved.keys()]).toEqual([...before.keys()]);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  const main = new TextDecoder().decode(saved.get("word/document.xml")!); expect(main).toContain("<!--retain-->"); expect(main).toContain("<?audit exact?>"); expect(main).toContain('<w:b/>'); expect(readPackage(input)).toEqual(before);
  });
  it("inventories unique least-unused IDs and cleared placeholders", async () => {
  expect(output, "Verified publication candidate").toBeDefined();
  if (!output || !context) throw new Error("No verified publication candidate.");
  const controls = (await api.inspectDocumentControls(output, {}, context)).items;
  expect(new Set(controls.map(control => control.id)).size).toBe(controls.length); expect(controls.every(control => control.id !== "777")).toBe(true);
  if (boundary.endsWith("1000")) {
    const expectedIds: string[] = [];
    for (let candidate = 1; expectedIds.length < 2000; candidate++) if (![10, 11, 30, 777].includes(candidate)) expectedIds.push(String(candidate));
    expect(controls.slice(1).map(control => control.id)).toEqual(expectedIds);
  }
  expect(controls.filter(control => control.tag === "entry").every(control => !control.placeholder)).toBe(true);
  });
  it("extracts every record and retains the untouched source", async () => {
  expect(output, "Verified publication candidate").toBeDefined();
  if (!output || !context) throw new Error("No verified publication candidate.");
  const text = (await api.extractDocumentText(output, context)).text;
  expect(text).toBe('Outside {{entry}}\n'+(boundary === "depth4" ? "Nested leaf 海" : Array.from({ length: 1000 }, (_, index) => `Record ${index} 海`).join("\n")));
  expect(readPackage(input)).toEqual(before);
  });
});
