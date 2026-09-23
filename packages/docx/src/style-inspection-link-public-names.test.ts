import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const field of ["base", "next", "linkedStyle", "self-next"] as const) for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`exposes reusable public ${field} names beside exact custom collisions; ${route}; ${carrier}; strict=${strict}`, async () => {
  const head = `<w:style w:type="paragraph" w:styleId="Head"><w:name w:val="heading 1"/>${field === "linkedStyle" ? '<w:link w:val="Detail"/>' : ""}<w:rPr><w:b/></w:rPr></w:style>`, shadow = '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Shadow"><w:name w:val="heading 1"/><w:rPr><w:b w:val="0"/></w:rPr></w:style>', detail = `<w:style w:type="${field === "linkedStyle" ? "character" : "paragraph"}" w:customStyle="1" w:styleId="Detail"><w:name w:val="Detail"/>${field === "self-next" ? "" : `<w:${field === "base" ? "basedOn" : field === "next" ? "next" : "link"} w:val="Head"/>`}</w:style>`, active = head + shadow + detail, body = carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : '<f:kept/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : '<f:kept/>'}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture('<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:inspection-link-names" mc:Ignorable="f" mc:ProcessContent="f:pass">${body}<!--retain--><?audit original?></w:styles>` } }, strict), original = input.slice(), members = readPackage(input), document = await api.Document(input, textContext), selected = field === "self-next" ? "Heading 1" : "Detail", property = field === "self-next" ? "next" : field;
  expect(document.styles.at("Heading 1").style_id).toBe("Head"); expect(document.styles.at("heading 1").style_id).toBe("Shadow");
  if (field === "base") expect((document.styles.at("Detail") as api.CharacterStyle).base_style!.name).toBe("Heading 1");
  if (field === "next" || field === "self-next") expect((document.styles.at(selected) as api.ParagraphStyle).next_paragraph_style.name).toBe("Heading 1");
  let info: api.StyleInspectionData;
  const batch = { version: 1, operations: [{ operation: "styles.get", arguments: { name: selected } }] };
  if (route === "sdk") info = await api.inspectDocumentStyles(input, { name: selected }, textContext);
  else if (route === "sdk-batch") { const r = await api.executeDocumentBatch(input, batch, {}, { ...textContext, encoding: { order: "input", compression: "store" } }); expect(r.publication).toBeNull(); info = r.results[0]!.data as api.StyleInspectionData; }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retained")); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try {
    const command = route === "cli" ? `docx styles get /input --name '${selected}' --json` : `docx batch /input --ops-json '${JSON.stringify(batch)}' --json`, r = await shell.exec(command); expect(r.exitCode, r.stdout + r.stderr).toBe(0); const envelope = JSON.parse(r.stdout); expect(envelope.affected).toBe(0); info = route === "cli" ? envelope.data : envelope.data.results[0].data; expect(await fs.readFile("/input")).toEqual(original); expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("Retained");
  } finally { await shell.dispose(); } }
  expect(info.styles[0]![property]).toBe("Heading 1"); expect(document.styles.at(info.styles[0]![property]!).style_id).toBe("Head");
  const memory = Volume.fromJSON({ "/out": "" }), result = await api.editDocumentStyles(input, { operation: "styles.set", name: selected, [property]: info.styles[0]![property], output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } });
  // An explicit self-next edge may be materialized, but it must retain the original Head identity.
  expect(result.changed).toBe(field === "self-next"); const output = new Uint8Array(memory.readFileSync("/out") as Buffer), saved = readPackage(output); for (const [part, bytes] of members) if (field !== "self-next" || part !== "word/styles.xml") expect(saved.get(part), part).toEqual(bytes); const after = await api.inspectDocumentStyles(output, { name: selected }, textContext); expect(after.styles[0]![property]).toBe("Heading 1"); expect(input).toEqual(original);
});
