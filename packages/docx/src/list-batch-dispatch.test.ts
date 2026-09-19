import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure, assertPackageLinks } from "../tests/assertions.js";

type Node = ReturnType<typeof xmlStructure>;
const elements = (n: Node): Node[] => n.children.flatMap(c => typeof c === "string" ? [] : [c, ...elements(c)]);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const format of ["bullet", "decimal", "lowerLetter", "upperLetter", "lowerRoman", "upperRoman"] as const)
for (const level of [0, 1, 2, 3, 4, 5, 6, 7, 8]) for (const route of ["sdk-batch", "cli-batch"] as const)
it(`executes declared list add/set in staged order; ${format}; level=${level}; ${route}; ${kind}; strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Anchor 日本 עברית é 🌊</w:t></w:r></w:p><!--retain--><?policy keep?>', {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), batch = { version: 1, operations: [
    { id: "created", operation: "lists.add", arguments: { paragraph: 1, kind: format, level, text: "Created", start: 0 } },
    { id: "restart", operation: "lists.set", arguments: { paragraph: 2, restart: true, start: 7 } },
    { id: "read", operation: "paragraphs.get", arguments: { paragraph: 2 } }
  ] }, write = vi.fn(async (bytes: Uint8Array) => { memory.appendFileSync("/out", bytes); });
  if (route === "sdk-batch") { const r = await api.executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, stdout: { write }, encoding: { order: "input", compression: "store" } }); expect(r.results.map(x => x.id)).toEqual(["created", "restart", "read"]); expect(r.results.map(x => x.affected)).toEqual([1, 1, 0]); expect(write).toHaveBeenCalledTimes(1); }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch)}' --output /out --json`); expect(r.exitCode, r.stdout + r.stderr).toBe(0); const e = JSON.parse(r.stdout); expect(e.data.results.map((x: { affected: number }) => x.affected)).toEqual([1, 1, 0]); memory.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), saved = readPackage(output); assertPackageLinks(saved);
  for (const [name, bytes] of parts) if (!["word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"].includes(name)) expect(saved.get(name), name).toEqual(bytes);
  const numberingName = elements(xmlStructure(saved.get("[Content_Types].xml")!)).find(n => n.attributes["{}ContentType"] === "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml")?.attributes["{}PartName"]?.slice(1); expect(numberingName).toBeDefined();
  const ns = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", num = elements(xmlStructure(saved.get(numberingName!)!)), attr = (n: Node, key: string) => n.attributes[`{${ns}}${key}`];
  expect(num.filter(n => n.name === `{${ns}}numFmt`).map(n => attr(n, "val"))).toContain(format);
  expect(num.filter(n => n.name === `{${ns}}lvl`).map(n => attr(n, "ilvl"))).toContain(String(level));
  expect(num.filter(n => n.name === `{${ns}}startOverride`).map(n => attr(n, "val"))).toEqual(["0", "7"]);
  const d = await api.Document(output, textContext); expect(d.paragraphs.map(p => p.text)).toEqual(["Anchor 日本 עברית é 🌊", "Created"]);
  expect(new TextDecoder().decode(saved.get("word/document.xml"))).toContain('<!--retain--><?policy keep?>');
});

for (const strict of [false, true]) for (const route of ["sdk-batch", "cli-batch"] as const)
it(`rolls back created list resources after a late missing paragraph; ${route}; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Anchor</w:t></w:r></w:p>', {}, strict), batch = { version: 1, operations: [
    { operation: "lists.add", arguments: { paragraph: 1, kind: "decimal", text: "Created" } },
    { operation: "lists.set", arguments: { paragraph: 99, restart: true } }
  ] }, memory = Volume.fromJSON({ "/out": "" }), write = vi.fn(async (bytes: Uint8Array) => { memory.appendFileSync("/out", bytes); });
  if (route === "sdk-batch") { await expect(api.executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, stdout: { write }, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "missing-selection", operationIndex: 1 }); expect(write).not.toHaveBeenCalled(); }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode('Retain destination')); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch)}' --output /out --force --json`); expect(r.exitCode, r.stdout + r.stderr).toBe(1); expect(JSON.parse(r.stdout).errors[0]).toMatchObject({ code: "missing-selection", operationIndex: 1 }); expect(new TextDecoder().decode(await fs.readFile('/out'))).toBe('Retain destination'); expect(await fs.readFile('/input')).toEqual(input); } finally { await shell.dispose(); }
  }
});
