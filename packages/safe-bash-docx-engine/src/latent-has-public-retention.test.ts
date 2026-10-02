import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { readPackage } from "../tests/assertions.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
for (const route of ["model", "sdk", "cli"])
it(`executes exact latent membership without materialization; ${route}; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const active = '<w:lsdException w:name="Ghost"/><w:lsdException w:name="heading 1"/>', inert = '<w:lsdException w:name="Inert"/>';
  const entries = carrier === "direct" ? active + `<f:opaque>${inert}</f:opaque>` : carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque>${inert}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inert}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inert}</mc:Fallback></mc:AlternateContent>`;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:membership" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:latentStyles>${entries}<!--retain--><?policy keep?></w:latentStyles></w:styles>` } }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  const names = ["Ghost", "Missing", "ghost", "Inert", "Heading 1", "heading 1"], expected = [true, false, false, false, true, true];
  const operations = [{ operation: "model.document.Document.styles.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "styles" }, { operation: "model.styles.styles.Styles.latent_styles.get", receiver: { resultHandle: "styles" }, arguments: {}, resultHandle: "latent" }, ...names.map(name => ({ operation: "model.styles.latent.LatentStyles.has.call", receiver: { resultHandle: "latent" }, arguments: { name } }))];
  if (route === "model") {
    const document = await api.Document(input, textContext), latent = document.styles.latent_styles;
    expect(names.map(name => latent.has(name))).toEqual(expected);
    for (const invalid of [null, false, 1, {}]) expect(() => latent.has(invalid as string)).toThrow(TypeError);
    expect(latent.length).toBe(2); await document.save(sink);
  } else if (route === "sdk") {
    const applied = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    expect(applied.affected).toBe(0); expect(applied.results.slice(2).map(result => result.value)).toEqual(expected);
    await applied.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /out --json`);
      expect(r.exitCode, r.stdout + r.stderr).toBe(0); const envelope = JSON.parse(r.stdout);
      expect(envelope.affected).toBe(0); expect(envelope.data.results.slice(2).map((result: { data: boolean }) => result.data)).toEqual(expected);
      volume.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  expect(readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer))).toEqual(parts);
  expect(new Uint8Array(volume.readFileSync("/input") as Buffer)).toEqual(input);
});
