import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
for (const route of ["sdk", "shell"])
it(`${route} exposes required latent name diagnostics in noncreating style inspection; strict=${strict}; kind=${kind}; carrier=${carrier}`, async () => {
  const leaf = '<w:lsdException w:locked="0"/>', wrapped = carrier === "direct" ? leaf : carrier === "process" ? `<f:pass>${leaf}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? leaf : '<w:lsdException w:name="Inactive"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? leaf : '<w:lsdException w:name="Inactive"/>'}</mc:Fallback></mc:AlternateContent>`, parts = readPackage(await textFixture('<w:p><w:r><w:t>Original é 日本 עברית 🌊</w:t></w:r></w:p>', {styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:latent-diagnostics" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:latentStyles>${wrapped}<!--retain--><?audit keep?></w:latentStyles></w:styles>`}}, strict)), memory = Volume.fromJSON({"/input": ""});
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  await api.writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "sdk") {const result = await api.inspectDocumentStyles(input, {latent: true}, textContext); expect(result.latent!.entries).toHaveLength(1); expect(result.diagnostics).toContainEqual(expect.objectContaining({code: "latent-name", part: "/word/styles.xml"}));}
  else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: api.createDocxInspectionCommandEngine({limits: textContext.limits})})); try {const result = await shell.exec("docx styles latent list /input --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); const data = JSON.parse(result.stdout).data; expect(data.latent.entries).toHaveLength(1); expect(data.diagnostics).toContainEqual(expect.objectContaining({code: "latent-name", part: "/word/styles.xml"})); expect(await fs.readFile("/input")).toEqual(input);} finally {await shell.dispose();}}
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
