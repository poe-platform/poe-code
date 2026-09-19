import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
const enc = (s: string) => new TextEncoder().encode(s);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const present of [false, true]) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} creates native numbering style or rejects direct utility creation; present=${present}; ${kind}; strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>', present ? { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Retained"><w:name w:val="Retained"/></w:style><!--retain--><?policy keep?></w:styles>` } } : {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const v = Volume.fromJSON({ "/input": "", "/out": "" }); await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([n, bytes]) => ({ name: n, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { v.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(v.readFileSync("/input") as Buffer), sink = { async write(bytes: Uint8Array) { v.appendFileSync("/out", bytes); } };
  if (route === "model") { const doc = await api.Document(input, textContext); const added = doc.styles.add_style("caption", api.WD_STYLE_TYPE.LIST); expect(added.name).toBe("caption"); expect(added.type).toBe(api.WD_STYLE_TYPE.LIST); await doc.save(sink); }
  else if (route === "sdk") { await expect(api.editDocumentStyles(input, { operation: "styles.add", name: "caption", type: "numbering", output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink })).rejects.toMatchObject({ code: "unsupported-edit" }); expect(v.readFileSync("/out")).toHaveLength(0); expect(v.readFileSync("/input")).toEqual(Buffer.from(input)); return; }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", enc("retained destination")); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const r = await shell.exec("docx styles add /input --name caption --type numbering --output /out --force --json"); expect(r.exitCode, r.stdout + r.stderr).toBe(1); expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] }); expect(await fs.readFile("/out")).toEqual(enc("retained destination")); expect(await fs.readFile("/input")).toEqual(input); return; } finally { await shell.dispose(); } }
  const output = new Uint8Array(v.readFileSync("/out") as Buffer), saved = readPackage(output); assertPackageLinks(saved); const doc = await api.Document(output, textContext), added = doc.styles.at("caption");
  expect([added.name, added.type.name, added.builtin]).toEqual(["caption", "LIST", false]); expect(added.style_id).toBeTruthy(); expect(doc.paragraphs[0]!.text).toBe("Retain é 日本 עברית 🌊"); expect(added.element.children.some(n => n.tag.localName === "rPr" || n.tag.localName === "pPr")).toBe(false);
  if (present) { for (const [n, bytes] of parts) if (n !== "word/styles.xml") expect(saved.get(n), n).toEqual(bytes); expect(new TextDecoder().decode(saved.get("word/styles.xml"))).toContain("<!--retain--><?policy keep?>"); expect(doc.styles.at("Retained").style_id).toBe("Retained"); }
  else for (const [n, bytes] of parts) if (n !== "[Content_Types].xml" && n !== "word/_rels/document.xml.rels") expect(saved.get(n), n).toEqual(bytes);
  expect(v.readFileSync("/input")).toEqual(Buffer.from(input));
});
