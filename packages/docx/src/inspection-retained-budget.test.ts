import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { DocumentBudget, createDocxInspectionCommandEngine, inspectDocument, writeArchive } from "./index.js";
import { createDocumentFixture } from "../tests/fixtures/documents.js";
import { readPackage } from "../tests/assertions.js";

const limits = {maxArchiveBytes: 65536, maxEntryBytes: 16384, maxTotalBytes: 65536, maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 1024, maxCommentBytes: 1024, maxRetainedBytes: 500000, chunkSize: 1024};
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "shell"] as const)
it(`${route} inventories invalid table geometry within 500000 retained bytes; ${kind} strict=${strict}`, async () => {
  const signal = new AbortController().signal, context = {limits, signal};
  const parts = readPackage((await createDocumentFixture("museum", "invalid-grid")).bytes), encoder = new TextEncoder();
  for (const [name, bytes] of parts) if (name.endsWith(".xml") || name.endsWith(".rels")) {
    let xml = new TextDecoder().decode(bytes);
    if (strict) for (const [before, after] of [
      ["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"],
      ["http://schemas.openxmlformats.org/officeDocument/2006/relationships", "http://purl.oclc.org/ooxml/officeDocument/relationships"],
      ["http://schemas.openxmlformats.org/drawingml/2006/", "http://purl.oclc.org/ooxml/drawingml/"]
    ]) xml = xml.split(before!).join(after!);
    if (kind === "dotx") xml = xml.replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml");
    parts.set(name, encoder.encode(xml));
  }
  const volume = Volume.fromJSON({"/input": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {volume.appendFileSync("/input", bytes);}}, {order: "input", compression: "deflate"}, {...context, limits: {...limits, maxRetainedBytes: 8 * 1024 * 1024}});
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer);
  let data;
  if (route === "sdk") {
    const budget = new DocumentBudget({retainedBytes: 500000}, signal);
    data = await inspectDocument(input, {...context, budget});
    expect(budget.usage.retainedBytes).toBeLessThanOrEqual(500000);
    await expect(inspectDocument(input, {...context, budget: new DocumentBudget({retainedBytes: 1000}, signal)})).rejects.toMatchObject({code: "limit-exceeded"});
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits})}));
    const result = await shell.exec("docx inspect /input --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(0); data = JSON.parse(result.stdout).data;
    const refused = await shell.exec("docx inspect /input --limit retainedBytes=1000 --json");
    expect(refused.exitCode).toBe(4); expect(JSON.parse(refused.stdout).errors[0].code).toBe("limit-exceeded");
    expect(await fs.readFile("/input")).toEqual(input);
  }
  expect(data.kind).toBe(kind); expect(data.dialect).toBe(strict ? "strict" : "transitional");
  expect(data.counts).toEqual({paragraphs: 9, runs: 8, tables: 2, rows: 5, cells: 7, images: 2, sections: 1, comments: 0, footnotes: 0, endnotes: 0, fields: 0, controls: 0, equations: 0, cachedPages: null});
  expect(data.parts).toHaveLength(8); expect(data.signed).toBe(false); expect(data.protected).toBe(false);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
