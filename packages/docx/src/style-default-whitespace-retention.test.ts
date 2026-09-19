import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const route of ["sdk", "cli"] as const)
it(`same default-style assignment retains legal lexical whitespace; ${route}; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Atlas" w:default=" &#x9;true&#xA; "><w:name w:val="Atlas"/><!--retain--><?policy keep?></w:style></w:styles>` } }, strict);
  const memory = Volume.fromJSON({ "/out": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  if (route === "sdk") { const r = await api.editDocumentStyles(input, { operation: "styles.set", name: "Atlas", defaultForType: true, output: "-" }, { ...textContext, stdout: sink, encoding: { order: "input", compression: "store" } }); expect(r.changed).toBe(false); }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const r = await shell.exec("docx styles set /input --name Atlas --default-for-type true --output /out --json"); expect(r.exitCode, r.stdout + r.stderr).toBe(0); expect(JSON.parse(r.stdout).data.changed).toBe(false); memory.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); }
  }
  expect(readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
});

for (const strict of [false, true])
it(`diagnoses duplicate legal spaced default-style markers; strict=${strict}`, async () => {
  const input = await textFixture('<w:p/>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="One" w:default=" &#x9;true&#xA; "><w:name w:val="One"/></w:style><w:style w:type="paragraph" w:styleId="Two" w:default=" &#xD;1&#xA; "><w:name w:val="Two"/></w:style></w:styles>` } }, strict);
  const report = api.validateDocumentArchive(await api.readArchive(input, textContext));
  expect(report.valid).toBe(false); expect(report.diagnostics.some(d => d.code === "style-default")).toBe(true);
});
