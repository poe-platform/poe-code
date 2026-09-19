import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import { styleFontFlags } from "./style-font-flags.js";

const enc = (value: string) => new TextEncoder().encode(value);
async function fixture(markup: string, strict: boolean, kind: "docx" | "dotx", carrier: string) {
  const inert = '<w:style w:type="paragraph" w:styleId="Inert" w:customStyle="invalid"><w:name w:val="Inert"/><w:uiPriority w:val="invalid"/></w:style>';
  const active = carrier === "direct" ? markup + `<f:opaque>${inert}</f:opaque>` : carrier === "process" ? `<f:pass>${markup}</f:pass><f:opaque>${inert}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? markup : inert}</mc:Choice><mc:Fallback>${carrier === "fallback" ? markup : inert}</mc:Fallback></mc:AlternateContent>`;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:whitespace" mc:Ignorable="f" mc:ProcessContent="f:pass">${active}<!--retain--><?policy keep?></w:styles>` } }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  return { input: new Uint8Array(volume.readFileSync("/input") as Buffer), volume, parts };
}
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
for (const [token, expected] of [["true", true], ["false", false], ["1", true], ["0", false]] as const)
for (const route of ["model", "sdk", "cli"] as const)
it(`reads XML whitespace in style flags, latent settings and custom/default markers; ${token}; ${route}; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const val = ` &#x9;${token}&#xD;&#xA; `, run = Object.values(styleFontFlags).map(tag => `<w:${tag} w:val="${val}"/>`).join("");
  const markup = `<w:latentStyles w:defSemiHidden="${val}" w:defLockedState="${val}" w:defQFormat="${val}" w:defUnhideWhenUsed="${val}" w:count=" &#x9;7&#xA; "><w:lsdException w:name="Atlas" w:semiHidden="${val}" w:locked="${val}" w:qFormat="${val}" w:unhideWhenUsed="${val}"/></w:latentStyles><w:style w:type="paragraph" w:styleId="Atlas" w:customStyle="${val}" w:default="${val}"><w:name w:val="heading 1"/><w:semiHidden w:val="${val}"/><w:locked w:val="${val}"/><w:qFormat w:val="${val}"/><w:unhideWhenUsed w:val="${val}"/><w:rPr>${run}</w:rPr><w:pPr><w:keepNext w:val="${val}"/><w:keepLines w:val="${val}"/><w:widowControl w:val="${val}"/><w:pageBreakBefore w:val="${val}"/></w:pPr></w:style>`;
  const { input, volume, parts } = await fixture(markup, strict, kind, carrier);
  const name = expected ? "heading 1" : "Heading 1";
  if (route === "model") {
    const d = await api.Document(input, textContext), s = d.styles.at(name) as api.ParagraphStyle;
    expect(s.name).toBe(name); expect(s.builtin).toBe(!expected); expect(d.styles.default(api.WD_STYLE_TYPE.PARAGRAPH)?.style_id ?? null).toBe(expected ? "Atlas" : null);
    expect([s.hidden, s.locked, s.quick_style, s.unhide_when_used]).toEqual(Array(4).fill(expected));
    for (const key of Object.keys(styleFontFlags)) {
      const publicKey = ({ allCaps: "all_caps", complexScriptEnabled: "complex_script", csBold: "cs_bold", csItalic: "cs_italic", doubleStrike: "double_strike", noProof: "no_proof", smallCaps: "small_caps", snapToGrid: "snap_to_grid", specVanish: "spec_vanish", webHidden: "web_hidden", fontHidden: "hidden" } as Record<string, string>)[key] ?? key;
      expect(Reflect.get(s.font, publicKey), publicKey).toBe(expected);
    }
    expect([s.paragraph_format.keep_with_next, s.paragraph_format.keep_together, s.paragraph_format.widow_control, s.paragraph_format.page_break_before]).toEqual(Array(4).fill(expected));
    const l = d.styles.latent_styles, e = l.at("Atlas");
    expect([l.default_to_hidden, l.default_to_locked, l.default_to_quick_style, l.default_to_unhide_when_used, e.hidden, e.locked, e.quick_style, e.unhide_when_used]).toEqual(Array(8).fill(expected));
    expect(l.load_count).toBe(7);
    await d.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
    expect(readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer))).toEqual(parts);
  } else {
    let data: api.StyleInspectionData;
    if (route === "sdk") data = await api.inspectDocumentStyles(input, {}, textContext);
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try { const r = await shell.exec("docx styles list /input --json"); expect(r.exitCode, r.stdout + r.stderr).toBe(0); data = JSON.parse(r.stdout).data; expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); }
    }
    const s = data.styles[0]!; expect(s).toMatchObject({ name, builtin: !expected, defaultForType: expected, hidden: expected, locked: expected, quickStyle: expected, unhideWhenUsed: expected });
    for (const key of [...Object.keys(styleFontFlags), "keepWithNext", "keepTogether", "widowControl", "pageBreakBefore"]) expect(Reflect.get(s.direct, key), key).toBe(expected);
    expect(data.latent?.defaults).toMatchObject({ defaultToHidden: expected, defaultToLocked: expected, defaultToQuickStyle: expected, defaultToUnhideWhenUsed: expected, loadCount: 7 });
    expect(data.latent?.entries[0]).toMatchObject({ hidden: expected, locked: expected, quickStyle: expected, unhideWhenUsed: expected });
  }
});

const integerCases = [
  { name: "style priority", markup: (value: string) => `<w:style w:type="paragraph" w:styleId="Atlas"><w:name w:val="Atlas"/><w:uiPriority w:val="${value}"/></w:style>`, read: (d: api.DocumentView) => d.styles.at("Atlas").priority },
  { name: "latent count", markup: (value: string) => `<w:latentStyles w:count="${value}"/>`, read: (d: api.DocumentView) => d.styles.latent_styles.load_count },
  { name: "latent default priority", markup: (value: string) => `<w:latentStyles w:defUIPriority="${value}"/>`, read: (d: api.DocumentView) => d.styles.latent_styles.default_priority },
  { name: "latent override priority", markup: (value: string) => `<w:latentStyles><w:lsdException w:name="Atlas" w:uiPriority="${value}"/></w:latentStyles>`, read: (d: api.DocumentView) => d.styles.latent_styles.at("Atlas").priority },
  { name: "outline level", markup: (value: string) => `<w:style w:type="paragraph" w:styleId="Atlas"><w:name w:val="Atlas"/><w:pPr><w:outlineLvl w:val="${value}"/></w:pPr></w:style>`, read: null }
];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
for (const whitespace of ["\u00a0", "\u2003"]) for (const scenario of integerCases)
for (const route of ["model", "sdk", "cli"] as const)
if (scenario.read !== null || route !== "model") it(`rejects non-XML whitespace in ${scenario.name}; U+${whitespace.codePointAt(0)!.toString(16)}; ${route}; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const { input } = await fixture(scenario.markup(`${whitespace}7${whitespace}`), strict, kind, carrier);
  if (route === "model") { await expect((async () => { const d = await api.Document(input, textContext); return scenario.read!(d); })()).rejects.toMatchObject({ code: "invalid-package" }); }
  else if (route === "sdk") await expect(api.inspectDocumentStyles(input, {}, textContext)).rejects.toMatchObject({ code: "invalid-package" });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const r = await shell.exec("docx styles list /input --json"); expect(r.exitCode, r.stdout + r.stderr).toBe(1); expect(JSON.parse(r.stdout).errors[0].code).toBe("invalid-package"); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); }
  }
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
for (const [token, expected] of [["true", true], ["false", false], ["1", true], ["0", false]] as const)
for (const route of ["model", "sdk", "cli"] as const)
it(`independently classifies spaced style custom/default markers without other flags; ${token}; ${route}; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const value = ` &#x9;${token}&#xD;&#xA; `;
  const { input } = await fixture(`<w:style w:type="paragraph" w:styleId="Atlas" w:customStyle="${value}" w:default="${value}"><w:name w:val="heading 1"/></w:style>`, strict, kind, carrier);
  const name = expected ? "heading 1" : "Heading 1";
  if (route === "model") {
    const d = await api.Document(input, textContext), s = d.styles.at(name);
    expect(s.name).toBe(name); expect(s.builtin).toBe(!expected);
    expect(d.styles.default(api.WD_STYLE_TYPE.PARAGRAPH)?.style_id ?? null).toBe(expected ? "Atlas" : null);
    expect(d.paragraphs[0]!.style?.style_id ?? null).toBe(expected ? "Atlas" : null);
    expect(() => d.styles.add_style(name, api.WD_STYLE_TYPE.PARAGRAPH)).toThrowError(api.InvalidValueError);
  } else if (route === "sdk") expect((await api.inspectDocumentStyles(input, { name }, textContext)).styles[0]).toMatchObject({ id: "Atlas", name, builtin: !expected, defaultForType: expected });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const r = await shell.exec(`docx styles get /input --name '${name}' --json`); expect(r.exitCode, r.stdout + r.stderr).toBe(0); expect(JSON.parse(r.stdout).data.styles[0]).toMatchObject({ id: "Atlas", name, builtin: !expected, defaultForType: expected }); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); }
  }
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
for (const route of ["model", "sdk", "cli"] as const)
it(`creates distinct builtin heading beside spaced-true custom heading name; ${route}; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const { input, volume, parts } = await fixture('<w:style w:type="paragraph" w:styleId="Heading1" w:customStyle=" &#x9;true&#xA; "><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><!--custom-retain--></w:style>', strict, kind, carrier);
  const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  if (route === "model") { const d = await api.Document(input, textContext); const p = d.add_heading("Created", 1); expect(p.style?.style_id).toBe("Heading11"); expect(p.style?.name).toBe("Heading 1"); await d.save(sink); }
  else if (route === "sdk") await api.createDocument({ template: input, content: { version: 1, blocks: [{ kind: "paragraph", level: 1, text: "Created" }] } }, { output: "-" }, { ...textContext, stdout: sink, encoding: { order: "input", compression: "store" } });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const r = await shell.exec(`docx create --template /input --content-json '{"version":1,"blocks":[{"kind":"paragraph","level":1,"text":"Created"}]}' --output /out`); expect(r.exitCode, r.stdout + r.stderr).toBe(0); volume.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); }
  }
  const saved = readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer));
  for (const [name, bytes] of parts) if (name !== "word/document.xml" && name !== "word/styles.xml") expect(saved.get(name), name).toEqual(bytes);
  const reopened = await api.Document(new Uint8Array(volume.readFileSync("/out") as Buffer), textContext);
  const custom = reopened.styles.at("heading 1"); expect([custom.style_id, custom.builtin, custom.name]).toEqual(["Heading1", false, "heading 1"]);
  const builtin = reopened.styles.at("Heading 1"); expect([builtin.style_id, builtin.builtin, builtin.name]).toEqual(["Heading11", true, "Heading 1"]);
  expect(reopened.paragraphs.at(-1)?.text).toBe("Created");
  const xml = new TextDecoder().decode(saved.get("word/styles.xml")); expect(xml).toContain('<!--custom-retain-->'); expect(xml).toContain('w:customStyle=" &#x9;true&#xA; "');
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
it(`reuses builtin heading with legal spaced outline integer; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const { input, volume, parts } = await fixture('<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val=" &#x9;0&#xA; "/></w:pPr><!--builtin-retain--></w:style>', strict, kind, carrier);
  const d = await api.Document(input, textContext), p = d.add_heading("Created", 1); expect(p.style?.style_id).toBe("Heading1"); expect(d.styles.length).toBe(1);
  await d.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } }); const saved = readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer));
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
});
