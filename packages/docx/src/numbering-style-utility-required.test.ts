import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const enc = (text: string) => new TextEncoder().encode(text);
// DOCX6.4:751-752 explicitly defines unsupported utility creation, despite type admission at640.
// Every original carrier/route/dry-state identity is retained; native LIST positives remain in neighbor suites.
for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const) for (const dryRun of [false, true])
it(`${route} retains the explicit utility numbering rejection and unpublished stages in ${carrier}; strict=${strict}; dry=${dryRun}`, async () => {
  const active = '<w:style w:type="numbering" w:customStyle="1" w:styleId="Style1"><w:name w:val="Base list"/></w:style>', inert = '<w:style w:type="paragraph" w:styleId="Style2"><w:name w:val="Inert"/></w:style>';
  const body = carrier === "direct" ? active + `<f:shadow>${inert}</f:shadow>` : carrier === "process" ? `<f:pass>${active}</f:pass><f:shadow>${inert}</f:shadow>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inert}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inert}</mc:Fallback></mc:AlternateContent>`;
  const text = "Retain 日本 עברית é 🌊", input = await textFixture(`<w:p><w:r><w:rPr><w:rtl/><w:i/></w:rPr><w:t>${text}</w:t></w:r></w:p>`, { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:utility-numbering" mc:Ignorable="f" mc:ProcessContent="f:pass">${body}<!--retain--><?audit original?></w:styles>` } }, strict);
  const original = input.slice(), members = readPackage(input), memory = Volume.fromJSON({ "/out": "Retained sink" }), stdout = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } }, context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout }, name = "caption 日本 עברית", args = { name, type: "numbering" as const, base: "Base list", bold: false, italic: true, priority: 0 }, batch = { version: 1, operations: [{ operation: "text.replace", arguments: { find: "Retain", with: "Unpublished", first: true } }, { operation: "styles.add", arguments: args }] };
  if (route === "sdk") await expect(api.editDocumentStyles(input, { operation: "styles.add", ...args, output: "-", dryRun }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
  else if (route === "sdk-batch") await expect(api.executeDocumentBatch(input, batch, { output: "-", dryRun }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", enc("Retained destination")); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try {
    const command = route === "cli" ? `docx styles add /input --name '${name}' --type numbering --base 'Base list' --bold false --italic true --priority 0` : `docx batch /input --ops-json '${JSON.stringify(batch)}'`;
    const result = await shell.exec(command + " --output /out --force --json" + (dryRun ? " --dry-run" : "")); expect(result.exitCode, result.stdout + result.stderr).toBe(1); const envelope = JSON.parse(result.stdout); expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] }); expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/out")).toEqual(enc("Retained destination"));
  } finally { await shell.dispose(); } }
  expect(memory.readFileSync("/out").toString()).toBe("Retained sink"); expect(input).toEqual(original); expect(readPackage(input)).toEqual(members);
  const doc = await api.Document(input, textContext); expect(doc.paragraphs[0]!.text).toBe(text); expect(doc.styles.has(name)).toBe(false); expect(doc.styles.at("Base list").type).toBe(api.WD_STYLE_TYPE.LIST);
});
