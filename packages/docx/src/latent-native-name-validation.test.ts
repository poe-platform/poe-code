import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
for (const name of [undefined, "", "Original Native"])
for (const route of ["model", "sdk", "shell"])
it(`${route} validates required native latent name without creating read definitions; strict=${strict}; kind=${kind}; carrier=${carrier}; name=${String(name)}`, async () => {
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships", leaf = `<w:lsdException${name === undefined ? "" : ` w:name="${name}"`} w:semiHidden="0"/>`, inactive = '<w:lsdException f:inactive="untouched"/>', wrapped = carrier === "direct" ? leaf : carrier === "process" ? `<f:pass>${leaf}</f:pass><f:opaque>${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? leaf : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? leaf : inactive}</mc:Fallback></mc:AlternateContent>`,
    parts = readPackage(await textFixture('<w:p><w:r><w:t>Original é 日本 עברית 🌊</w:t></w:r></w:p>', {styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:latent-name" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:latentStyles>${wrapped}<!--retain--><?audit keep?></w:latentStyles></w:styles>`}}, strict)), memory = Volume.fromJSON({"/input": "", "/out": ""});
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  await api.writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), valid = name !== undefined, sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/out", bytes);}}, ref = (resultHandle: string) => ({resultHandle}), readOps = [
    {operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "part"},
    {operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("part"), arguments: {reltype: `${r}/styles`}, resultHandle: "stylesPart"},
    {operation: "model.parts.styles.StylesPart.styles.get", receiver: ref("stylesPart"), arguments: {}, resultHandle: "styles"},
    {operation: "model.styles.styles.Styles.latent_styles.get", receiver: ref("styles"), arguments: {}, resultHandle: "latent"},
    {operation: "model.styles.latent.LatentStyles.__len__.get", receiver: ref("latent"), arguments: {}}
  ];
  if (route === "model") {const doc = await api.Document(input, textContext); expect(doc.styles.latent_styles.length).toBe(1); expect(doc.styles.part.blob).toEqual(parts.get("word/styles.xml")); if (valid) await doc.save(sink); else await expect(doc.save(sink)).rejects.toMatchObject({code: "invalid-package", diagnostics: expect.arrayContaining([expect.objectContaining({code: "latent-name"})])});}
  else if (route === "sdk") {const result = await api.applyStyleModelBatch(input, {version: 1, operations: readOps}, textContext); expect(result.results.at(-1)!.value).toBe(1); expect(result.changes).toEqual([]); if (valid) await result.save(sink); else await expect(result.save(sink)).rejects.toMatchObject({code: "invalid-package", diagnostics: expect.arrayContaining([expect.objectContaining({code: "latent-name"})])});}
  else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Original destination")); const shell = new Shell({fs}).use(docxCommands({engine: api.createDocxInspectionCommandEngine({limits: textContext.limits})})); try {const creating = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({version: 1, operations: readOps})}' --json`); expect(creating.exitCode, creating.stdout + creating.stderr).toBe(2); const read = await shell.exec("docx styles latent list /input --json"); expect(read.exitCode, read.stdout + read.stderr).toBe(0); expect(JSON.parse(read.stdout).data.latent.entries).toHaveLength(1); expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");
    const operations = [{operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles"}, ...readOps.slice(3)], edit = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({version: 1, operations})}' --output /out --force --json`); expect(edit.exitCode, edit.stdout + edit.stderr).toBe(valid ? 0 : 1); if (valid) memory.writeFileSync("/out", await fs.readFile("/out")); else {expect(JSON.parse(edit.stdout).errors[0].code).toBe("invalid-package"); expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");} expect(await fs.readFile("/input")).toEqual(input);
  } finally {await shell.dispose();}}
  const report = api.validateDocumentArchive(await api.readArchive(input, textContext)); expect(report.valid).toBe(valid); expect(report.diagnostics.map(d => d.code)).toEqual(valid ? [] : ["latent-name"]);
  if (valid) {const after = readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer)); assertPackageLinks(after); for (const [part, bytes] of parts) expect(after.get(part), part).toEqual(bytes);} else expect(memory.readFileSync("/out")).toEqual(Buffer.from("")); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
