import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

type Variant = { name: string; type: "paragraph" | "character" | "table"; body?: string; definition?: string; stories?: Record<string, {kind: string; xml: string}> };
const variants: readonly Variant[] = [
  { name: "character reference", type: "character", body: '<w:p><w:r><w:rPr><w:rStyle w:val="Style1"/></w:rPr><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>' },
  { name: "table reference", type: "table", body: '<w:tbl><w:tblPr><w:tblStyle w:val="Style1"/></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>' },
  ...["basedOn", "next", "link"].map<Variant>(tag => ({ name: `style ${tag}`, type: tag === "link" ? "character" : "paragraph", definition: `<w:style w:type="paragraph" w:styleId="Dependent"><w:name w:val="Dependent"/><w:${tag} w:val="Style1"/></w:style>` })),
  ...["styleLink", "numStyleLink"].map<Variant>(tag => ({ name: `numbering ${tag}`, type: "paragraph", stories: { numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="0"><w:${tag} w:val="Style1"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>` } } })),
  { name: "numbering level paragraph reference", type: "paragraph", stories: { numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Style1"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum></w:numbering>` } } },
  { name: "header reference", type: "paragraph", stories: { header: { kind: "header", xml: `<w:hdr xmlns:w="${w}"><w:p><w:pPr><w:pStyle w:val="Style1"/></w:pPr><w:r><w:t>header</w:t></w:r></w:p></w:hdr>` } } },
  { name: "settings default table", type: "table", stories: { settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}"><w:defaultTableStyle w:val="Style1"/></w:settings>` } } },
  { name: "inactive paragraph reference", type: "paragraph", body: '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:unknown"><mc:Choice Requires="x"><w:p><w:pPr><w:pStyle w:val="Style1"/></w:pPr></w:p></mc:Choice><mc:Fallback><w:p><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent>' },
] as const;
for (const variant of variants) for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["native", "sdk-style", "sdk-create", "sdk-batch", "cli-style", "cli-create", "cli-model"] as const)
it(`reserves unselected dangling ${variant.name} during unrelated style allocation; ${route}; ${kind}; strict=${strict}`, async () => {
  const expectedInvalid = ["numbering styleLink", "numbering numStyleLink"].includes(variant.name);
  const body = variant.body ?? '<w:p><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>';
  const parts = readPackage(await textFixture(body, {
    ...(variant.stories ?? {}),
    styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${variant.definition ?? ""}<!--retained--><?audit retained?></w:styles>` }
  }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/out": "" });
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = await api.Document(input, textContext);
  expect(before.paragraphs[0]!.style!.name).toBe("Normal");
  const publication = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink };
  const content = { version: 1 as const, blocks: [], styles: [{ name: "New coast", type: variant.type as "paragraph" | "character" | "table", bold: true }] };
  const publish = async (operation: Promise<unknown>) => { if (expectedInvalid) await expect(operation).rejects.toMatchObject({ code: "invalid-package" }); else await operation; };
  if (route === "native") {
    if (expectedInvalid) {
      expect(() => before.styles.add_style("New coast", api.WD_STYLE_TYPE.PARAGRAPH)).toThrowError(expect.objectContaining({ code: "invalid-package" }));
      expect(before.styles.has("New coast")).toBe(false);
      await expect(before.save(sink)).rejects.toMatchObject({ code: "invalid-package" });
      expect(memory.readFileSync("/out")).toHaveLength(0);
      expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
      return;
    }
    const added = before.styles.add_style("New coast", api.WD_STYLE_TYPE[variant.type.toUpperCase() as "PARAGRAPH" | "CHARACTER" | "TABLE"]);
    expect(added.style_id).not.toBe("Style1");
    if (!(added instanceof api.ParagraphStyle || added instanceof api.CharacterStyle)) throw new Error("Expected a formatting style.");
    added.font.bold = true;
    await publish(before.save(sink));
  } else if (route === "sdk-style") await publish(api.editDocumentStyles(input, { operation: "styles.add", name: "New coast", type: variant.type, bold: true, output: "-" }, publication));
  else if (route === "sdk-create") await publish(api.createDocument({ template: input, content }, { output: "-" }, publication));
  else if (route === "sdk-batch") await publish(api.executeDocumentBatch(input, { version: 1, operations: [{ operation: "styles.add", arguments: { name: "New coast", type: variant.type, bold: true } }] }, { output: "-" }, publication));
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const model = { version: 1, operations: [{ operation: "model.document.Document.styles.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "styles" }, { operation: "model.styles.styles.Styles.add_style.call", receiver: { resultHandle: "styles" }, arguments: { name: "New coast", styleType: { enum: "WD_STYLE_TYPE", name: variant.type.toUpperCase() } }, resultHandle: "added" }] };
      const command = route === "cli-style" ? `docx styles add /input --name 'New coast' --type ${variant.type} --bold true` : route === "cli-create" ? `docx create --template /input --content-json '${JSON.stringify(content)}'` : `docx batch /input --ops-json '${JSON.stringify(model)}'`;
      const result = await shell.exec(command + " --output /destination --force --json");
      if (expectedInvalid) {
        expect(result.exitCode, result.stdout + result.stderr).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-package" }] });
        expect(await fs.readFile("/destination")).toEqual(new TextEncoder().encode("Retained destination"));
        expect(await fs.readFile("/input")).toEqual(input);
        return;
      }
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, errors: [] });
      expect(await fs.readFile("/input")).toEqual(input);
      memory.writeFileSync("/out", await fs.readFile("/destination"));
    } finally { await shell.dispose(); }
  }
  if (expectedInvalid) {
    expect(memory.readFileSync("/out")).toHaveLength(0);
    expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
    return;
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), after = await api.Document(output, textContext);
  expect(after.paragraphs[0]!.style!.name).toBe("Normal");
  expect(after.styles.at("New coast").style_id).not.toBe("Style1");
  expect(after.paragraphs[0]!.text).toBe("Retain 日本 עברית é 🌊");
  for (const [name, bytes] of parts) if (name !== "word/styles.xml") expect(readPackage(output).get(name), name).toEqual(bytes);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
