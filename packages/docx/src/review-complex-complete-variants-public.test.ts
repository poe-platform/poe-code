import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const native = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const run = '<w:r><w:t>Retained 海🌊</w:t></w:r>';
const cell = `<w:tc><w:p>${run}</w:p></w:tc>`;
const table = (properties: string, rowProperties = "", cellProperties = "") => `<w:tbl>${properties}<w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr>${rowProperties}<w:tc>${cellProperties}<w:p>${run}</w:p></w:tc></w:tr></w:tbl>`;
const id = 'w:id="7" w:author="Archive" w:date="2026-04-05T06:07:08Z"';
const scenarios: { name: string; body: string; markup: string; type: api.RevisionInfo["type"] }[] = [
  ...["moveFrom", "moveTo"].map(markup => ({ name: markup, body: `<w:p><w:${markup} ${id}>${run}</w:${markup}></w:p>`, markup, type: "move" as const })),
  ...["moveFrom", "moveTo"].flatMap(name => ["RangeStart", "RangeEnd"].map(suffix => ({ name: name + suffix, body: `<w:p><w:${name}RangeStart ${id}/>${run}<w:${name}RangeEnd w:id="7"/></w:p>`, markup: name + suffix, type: "move" as const }))),
  ...["ins", "del"].map(markup => ({ name: "paragraph-mark-" + markup, body: `<w:p><w:pPr><w:rPr><w:${markup} ${id}/></w:rPr></w:pPr>${run}</w:p>`, markup, type: (markup === "ins" ? "insert" : "delete") as api.RevisionInfo["type"] })),
  ...["ins", "del"].map(markup => ({ name: "row-mark-" + markup, body: table("", `<w:trPr><w:${markup} ${id}/></w:trPr>`), markup, type: (markup === "ins" ? "insert" : "delete") as api.RevisionInfo["type"] })),
  { name: "table-properties", body: table(`<w:tblPr><w:tblPrChange ${id}><w:tblPr/></w:tblPrChange></w:tblPr>`), markup: "tblPrChange", type: "table" },
  { name: "table-grid", body: `<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:tblGridChange ${id}><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid></w:tblGridChange></w:tblGrid><w:tr>${cell}</w:tr></w:tbl>`, markup: "tblGridChange", type: "table" },
  { name: "row-properties", body: table("", `<w:trPr><w:trPrChange ${id}><w:trPr/></w:trPrChange></w:trPr>`), markup: "trPrChange", type: "table" },
  { name: "cell-properties", body: table("", "", `<w:tcPr><w:tcPrChange ${id}><w:tcPr/></w:tcPrChange></w:tcPr>`), markup: "tcPrChange", type: "table" },
  ...["cellIns", "cellDel", "cellMerge"].map(markup => ({ name: markup, body: table("", "", `<w:tcPr><w:${markup} ${id}/></w:tcPr>`), markup, type: "table" as const })),
  { name: "section-properties", body: `<w:p>${run}</w:p><w:sectPr><w:sectPrChange ${id}><w:sectPr/></w:sectPrChange></w:sectPr>`, markup: "sectPrChange", type: "section" },
  { name: "unknown-history", body: `<w:p><w:futureChange ${id}>${run}</w:futureChange></w:p>`, markup: "futureChange", type: "unsupported" },
  { name: "compound-old-run-properties", body: `<w:p><w:r><w:rPr><w:b/><w:rPrChange ${id}><w:rPr><w:color w:val="123456"/></w:rPr></w:rPrChange></w:rPr><w:t>Retained 海🌊</w:t></w:r></w:p>`, markup: "rPrChange", type: "format" },
  { name: "nested-text-owners", body: `<w:p><w:ins ${id}><w:del w:id="8"><w:r><w:delText>Retained 海🌊</w:delText></w:r></w:del></w:ins></w:p>`, markup: "ins", type: "insert" },
  { name: "affected-control-owner", body: `<w:p><w:ins ${id}><w:sdt><w:sdtPr><w:text/></w:sdtPr><w:sdtContent>${run}</w:sdtContent></w:sdt></w:ins></w:p>`, markup: "ins", type: "insert" }
];

it("refuses an inline revision decision affected by table-grid history without publishing", async () => {
  const input = await textFixture(`<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:tblGridChange ${id}><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid></w:tblGridChange></w:tblGrid><w:tr><w:tc><w:p><w:ins w:id="8">${run}</w:ins></w:p></w:tc></w:tr></w:tbl>`);
  const original = input.slice();
  const inventory = await api.inspectDocumentRevisions(input, { view: "all" }, textContext);
  const revision = inventory.items.findIndex(item => item.id === "8") + 1;
  expect(revision).toBeGreaterThan(0);
  const memory = Volume.fromJSON({ "/output": "" });
  const stdout = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  await expect(api.editDocumentRevisionDecisions(input, {
    operation: "revisions.accept", options: { revision, output: "-" }
  }, { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" }, stdout })).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(memory.statSync("/output").size).toBe(0);
  expect(input).toEqual(original);

  const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination");
  await fs.writeFile("/input", input);
  await fs.writeFile("/output", destination);
  const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try {
    const result = await shell.exec(`docx revisions accept /input --revision ${revision} --output /output --force --json`);
    expect(result.exitCode, result.stdout + result.stderr).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ affected: 0, errors: [{ code: "unsupported-edit" }] });
    expect(await fs.readFile("/input")).toEqual(original);
    expect(await fs.readFile("/output")).toEqual(destination);
  } finally { await shell.dispose(); }
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const action of ["accept", "reject"] as const) for (const scenario of scenarios)
for (const route of ["sdk", "native-sdk", "sdk-batch", "native-sdk-batch", "cli", "native-cli", "cli-batch", "native-cli-batch"] as const)
it(`complete complex review preserve/refuse boundary; strict=${strict}; kind=${kind}; codec=${codec}; action=${action}; scenario=${scenario.name}; route=${route}`, async () => {
  const product: typeof api = route.startsWith("native") ? native as unknown as typeof api : api;
  const context = { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" } as const };
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Outside</w:t></w:r></w:p><!--retain--><?audit exact?>' + scenario.body, {}, strict, { kind }));
  if (codec !== "utf8") for (const [name, bytes] of parts) {
    const encoded = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le");
    if (codec === "utf16be") encoded.swap16();
    parts.set(name, new Uint8Array(encoded));
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "", "/model": "" });
  await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const inventory = await product.inspectDocumentRevisions(input, { view: "all" }, context);
  const selected = inventory.items.findIndex(item => item.markup === scenario.markup);
  expect(selected).toBeGreaterThanOrEqual(0);
  const rangeEnd = scenario.markup.endsWith("RangeEnd");
  expect(inventory.items[selected]).toMatchObject({ id: "7", author: rangeEnd ? null : "Archive", timestamp: rangeEnd ? null : "2026-04-05T06:07:08Z", type: scenario.type });
  for (const view of ["final", "original", "all"] as const) {
    const text = await product.extractDocumentText(input, context, { view });
    expect(text.text.startsWith("Outside")).toBe(true);
  }
  const document = await product.Document(input, context);
  await document.save({ async write(bytes: Uint8Array) { memory.appendFileSync("/model", bytes); } });
  expect(new Uint8Array(memory.readFileSync("/model") as Buffer)).toEqual(input);
  const operation = `revisions.${action}` as const;
  const options = { revision: selected + 1 }, batch = { version: 1 as const, operations: [{ operation, arguments: options }] };
  if (route.includes("sdk")) {
    const io = { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
    const pending = route.endsWith("batch") ? product.executeDocumentBatch(input, batch, { output: "-" }, io) : product.editDocumentRevisionDecisions(input, { operation, options: { ...options, output: "-" } }, io);
    await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" });
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained forced destination");
    await fs.writeFile("/input", input); await fs.writeFile("/output", destination); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const listed = await shell.exec("docx revisions list /input --view all --json");
      expect(listed.exitCode, listed.stdout + listed.stderr).toBe(0);
      const record = JSON.parse(listed.stdout).data.items[selected];
      expect(record.details).toMatchObject({ kind: "revisions", revisionId: 7, author: rangeEnd ? "" : "Archive", type: scenario.type });
      const response = await shell.exec((route.endsWith("batch") ? "docx batch /input --ops-file /ops" : `docx revisions ${action} /input --revision ${options.revision}`) + " --output /output --force --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(1);
      expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, data: null, affected: 0, locations: [], errors: [{ code: "unsupported-edit" }] });
      expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/output")).toEqual(destination);
    } finally { await shell.dispose(); }
  }
  expect(memory.statSync("/output").size).toBe(0); expect(input).toEqual(original);
  expect(readPackage(input)).toEqual(parts);
  expect((await product.inspectDocumentRevisions(input, { view: "all" }, context)).items).toEqual(inventory.items);
});
