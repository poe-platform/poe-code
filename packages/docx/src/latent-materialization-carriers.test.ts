import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const carrier of ["choice", "fallback", "process", "nested"] as const) for (const mixed of [false, true]) for (const route of ["model", "sdk", "cli"] as const)
it(`${route} materializes latent styles before admitted ${carrier} styles; mixed defaults=${mixed}; strict=${strict}`, async () => {
  const style = '<w:style w:type="paragraph" w:styleId="Retained"><w:name w:val="Retained"/><w:rPr><w:i/></w:rPr><!--retained--><?audit original?></w:style>';
  const inactive = '<w:style w:type="paragraph" w:styleId="Inert"><w:name w:val="Inert"/></w:style>';
  const defaults = '<w:docDefaults><w:rPrDefault><w:rPr><w:b/></w:rPr></w:rPrDefault></w:docDefaults>';
  const selected = (mixed ? defaults : "") + style, process = `<f:pass>${selected}</f:pass>`, active = carrier === "process" ? process : `<mc:AlternateContent><mc:Choice Requires="${carrier === "fallback" ? "f" : "w"}">${carrier === "fallback" ? inactive : carrier === "nested" ? process : selected}</mc:Choice><mc:Fallback>${carrier === "fallback" ? selected : inactive}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture('<w:p><w:r><w:t>Body retained 日本 עברית é 🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:latent-materialization" mc:Ignorable="f" mc:ProcessContent="f:pass">${mixed ? "" : defaults}${active}<!--root-retained--></w:styles>` } }, strict), memory = Volume.fromJSON({ "/out": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } }, operations = [{ operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" }, { operation: "model.styles.styles.Styles.latent_styles.get", receiver: ref("styles"), arguments: {}, resultHandle: "latent" }, { operation: "model.styles.latent.LatentStyles.__len__.get", receiver: ref("latent"), arguments: {} }];
  if (route === "model") { const d = await api.Document(input, textContext); expect(d.styles.latent_styles.length).toBe(0); await d.save(sink); }
  else if (route === "sdk") { const r = await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout: sink }); expect(r.results.at(-1)!.data).toBe(0); }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /out --json`); expect(r.exitCode, r.stdout + r.stderr).toBe(0); expect(JSON.parse(r.stdout).data.results.at(-1).data).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); } }
  const saved = readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer)), xml = new TextDecoder().decode(saved.get("word/styles.xml"));
  for (const [name, bytes] of readPackage(input)) if (name !== "word/styles.xml") expect(saved.get(name), name).toEqual(bytes);
  const spell = (text: string) => strict ? text.split(w).join("http://purl.oclc.org/ooxml/wordprocessingml/main") : text;
  for (const retained of [style, defaults, "<!--root-retained-->", ...(carrier === "process" ? [] : [inactive])]) expect(xml).toContain(spell(retained));
  const d = await api.Document(new Uint8Array(memory.readFileSync("/out") as Buffer), textContext); expect(d.styles.latent_styles.length).toBe(0); expect(d.styles.at("Retained")).toBeInstanceOf(api.ParagraphStyle); expect((d.styles.at("Retained") as api.ParagraphStyle).font.italic).toBe(true);
  const latent = xml.indexOf(":latentStyles"), defaultOffset = xml.indexOf("<w:docDefaults>"), styleOffset = xml.indexOf(style); expect(defaultOffset).toBeLessThan(latent); expect(latent).toBeLessThan(styleOffset);
});
