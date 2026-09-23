import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import { runElementOpen } from "./run-properties.js";

const mce = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const markers = ["tblPrChange", "trPrChange", "tcPrChange", "cellIns", "cellDel", "cellMerge"] as const;
const cache = new Map<string, Promise<Uint8Array>>();
async function fixture(strict: boolean, kind: "docx" | "dotx", carrier: string, marker: typeof markers[number], activeReview: boolean): Promise<Uint8Array> {
  const key = JSON.stringify([strict, kind, carrier, marker, activeReview]);
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const properties = marker.endsWith("Change") ? marker.slice(0, -6) : "tcPr";
      const annotation = `w:id="7" w:author="Original audit" w:date="2026-01-02T03:04:06Z"${marker === "cellMerge" ? ' w:vMerge="rest" w:vMergeOrig="cont"' : ""}`;
      const history = `<w:${marker} ${annotation}>${marker.endsWith("Change") ? `<w:${properties}/>` : ""}</w:${marker}>`;
      const row = (review: boolean, inert: boolean): string => `<w:tr><w:trPr>${review && marker === "trPrChange" ? history : ""}</w:trPr><w:tc><w:tcPr><w:tcW w:w="1440" w:type="dxa"/>${review && properties === "tcPr" ? history : ""}</w:tcPr>${review && marker === "tblPrChange" ? `<w:tbl><w:tblPr>${history}</w:tblPr><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>` : ""}<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${inert ? "Inert review 日本 עברית" : "Selected é 日本 עברית"}</w:t></w:r></w:p></w:tc></w:tr>`;
      const selected = row(activeReview, false), inactive = row(!activeReview, true);
      const wrapped = carrier === "choice" ? `<mc:AlternateContent><mc:Choice Requires="w">${selected}</mc:Choice><mc:Fallback>${inactive}</mc:Fallback></mc:AlternateContent>` : carrier === "fallback" ? `<mc:AlternateContent><mc:Choice Requires="f">${inactive}</mc:Choice><mc:Fallback>${selected}</mc:Fallback></mc:AlternateContent>` : `<f:pass>${selected}<f:sealed>${inactive}</f:sealed></f:pass>`;
      const input = await textFixture(`<w:tbl xmlns:mc="${mce}" xmlns:f="urn:original:inactive-table-review" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:tblPr/><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid>${wrapped}</w:tbl><w:p><w:r><w:t>Outside 日本 עברית é 🌊</w:t></w:r></w:p>`, {}, strict);
      if (kind === "docx") return input;
      const parts = readPackage(input), types = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!), main = types.root.children.find(n => n.attributes.some(a => a.name === "PartName" && a.value === "/word/document.xml"))!;
      const changed = { ...main, attributes: main.attributes.map(a => a.name === "ContentType" ? { ...a, value: "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml" } : a) };
      parts.set("[Content_Types].xml", new TextEncoder().encode(types.sourceXml(types.root, new Map([[main, runElementOpen(changed) + `</${main.name}>`]]))));
      const memory = Volume.fromJSON({ "/input": "" });
      await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
      return new Uint8Array(memory.readFileSync("/input") as Buffer);
    })();
    cache.set(key, pending);
  }
  return pending;
}
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["choice", "fallback", "process"]) for (const marker of markers)
for (const route of ["model", "direct", "sdk-batch", "cli", "cli-batch"] as const) for (const dry of [false, true])
it.concurrent(`whole cell text preserves inert native table history; ${strict}; ${kind}; ${carrier}; ${marker}; ${route}; dry=${dry}`, async () => {
  const input = await fixture(strict, kind, carrier, marker, false), original = input.slice(), parts = readPackage(input), memory = Volume.fromJSON({ "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } }, value = "Revised 日本 עברית é 🌊", args = { table: 1, cell: "A1", text: value }, batch = { version: 1, operations: [{ operation: "tables.set", arguments: args }] }, context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink };
  if (route === "model") { const doc = await api.Document(input, textContext); doc.tables[0]!.cell(0, 0).text = value; expect(doc.tables[0]!.cell(0, 0).text).toBe(value); if (!dry) await doc.save(sink); }
  else if (route === "direct") await api.editDocumentTables(input, { operation: "tables.set", options: { ...args, output: "-", dryRun: dry } }, context);
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, batch, { output: "-", dryRun: dry }, context);
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retained destination")); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try {
    const command = route === "cli" ? `docx tables set /input --table 1 --cell A1 --text '${value}'` : `docx batch /input --ops-json '${JSON.stringify(batch)}'`;
    const result = await shell.exec(command + " --output /destination --force --json" + (dry ? " --dry-run" : "")); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, affected: 1, errors: [] }); expect(await fs.readFile("/input")).toEqual(original); if (dry) expect(await fs.readFile("/destination")).toEqual(new TextEncoder().encode("Retained destination")); else memory.writeFileSync("/output", await fs.readFile("/destination"));
  } finally { await shell.dispose(); } }
  expect(input).toEqual(original);
  if (dry) { expect(memory.statSync("/output").size).toBe(0); return; }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const beforeXml = new api.DocumentXmlEditor(parts.get("word/document.xml")!), afterXml = new api.DocumentXmlEditor(after.get("word/document.xml")!), pending = [beforeXml.root]; let history: api.XmlElement | undefined;
  while (pending.length) { const node = pending.pop()!; if (node.localName === marker) history = node; pending.push(...node.children); }
  expect(history).toBeDefined(); expect(new TextDecoder().decode(after.get("word/document.xml"))).toContain(beforeXml.sourceXml(history!));
  expect(afterXml.sourceXml(afterXml.root.children[0]!.children[1]!)).toBe(beforeXml.sourceXml(beforeXml.root.children[0]!.children[1]!));
  const doc = await api.Document(output, textContext), changed = doc.tables[0]!.cell(0, 0); expect(changed.text).toBe(value); expect(changed.width!.inches).toBe(1); expect(changed.paragraphs).toHaveLength(1); expect(changed.paragraphs[0]!.runs).toHaveLength(1); expect(changed.paragraphs[0]!.paragraph_format.keep_with_next).toBe(null); expect(changed.paragraphs[0]!.runs[0]!.bold).toBe(null); expect(doc.paragraphs[0]!.text).toBe("Outside 日本 עברית é 🌊");
});
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["choice", "fallback", "process"]) for (const marker of markers)
it.concurrent(`active native table history still rejects scalar direct replacement; ${strict}; ${kind}; ${carrier}; ${marker}`, async () => {
  const input = await fixture(strict, kind, carrier, marker, true), before = input.slice(), memory = Volume.fromJSON({ "/output": "" });
  await expect(api.editDocumentTables(input, { operation: "tables.set", options: { table: 1, cell: "A1", text: "Must not publish", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(memory.statSync("/output").size).toBe(0); expect(input).toEqual(before);
});
