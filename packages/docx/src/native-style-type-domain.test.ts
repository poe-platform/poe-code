import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
for (const type of [undefined, "paragraph", "character", "table", "numbering", "", "unrecognized"])
for (const route of ["model", "sdk", "cli"])
it(`reads stored style role or rejects malformed document data; ${String(type)}; ${route}; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const active = `<w:style w:styleId="Atlas"${type === undefined ? "" : ` w:type="${type}"`}><w:name w:val="Atlas"/></w:style>`, inert = '<w:style w:styleId="Inert" w:type="unrecognized"><w:name w:val="Inert"/></w:style>';
  const content = carrier === "direct" ? active + `<f:opaque>${inert}</f:opaque>` : carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque>${inert}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inert}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inert}</mc:Fallback></mc:AlternateContent>`;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:style-type" mc:Ignorable="f" mc:ProcessContent="f:pass">${content}<!--retain--><?policy keep?></w:styles>` } }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } }, malformed = type === "" || type === "unrecognized", expected = { enum: "WD_STYLE_TYPE", name: type === "numbering" ? "LIST" : (type ?? "paragraph").toUpperCase() };
  const operations = [{ operation: "model.document.Document.styles.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "styles" }, { operation: "model.styles.style.BaseStyle.type.get", receiver: { resultHandle: "styles", key: "Atlas" }, arguments: {} }];
  if (route === "model") {
    const document = await api.Document(input, textContext);
    if (malformed) { expect(() => document.styles.at("Atlas").type).toThrow(api.InvalidDocumentError); expect(document.styles.part.blob).toEqual(parts.get("word/styles.xml")); }
    else { expect(document.styles.at("Atlas").type).toMatchObject(expected); await document.save(sink); }
  } else if (route === "sdk") {
    const run = api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    if (malformed) { await expect(run).rejects.toBeInstanceOf(api.InvalidDocumentError); await expect(run).rejects.toMatchObject({ code: "invalid-document", operationIndex: 1 }); }
    else { const applied = await run; expect(applied.affected).toBe(0); expect(applied.results.at(-1)!.value).toMatchObject(expected); await applied.save(sink); }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /destination --force --json`);
      expect(r.exitCode, r.stdout + r.stderr).toBe(malformed ? 1 : 0); const result = JSON.parse(r.stdout);
      if (malformed) { expect(result.errors[0].code).toBe("invalid-document"); expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("Original destination"); }
      else { expect(result.affected).toBe(0); expect(result.data.results.at(-1).data).toMatchObject(expected); volume.writeFileSync("/out", await fs.readFile("/destination")); }
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (malformed) expect(volume.readFileSync("/out").length).toBe(0);
  else expect(readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer))).toEqual(parts);
  expect(new Uint8Array(volume.readFileSync("/input") as Buffer)).toEqual(input);
});
