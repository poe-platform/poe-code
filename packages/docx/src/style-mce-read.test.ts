import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, ParagraphStyle, DocumentBudget, Twips, WD_ALIGN_PARAGRAPH, applyStyleModelBatch, createDocxInspectionCommandEngine, editDocumentStyles, inspectDocumentStyles, readArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const pPr = '<w:jc w:val="center"/><w:keepNext/><w:tabs><w:tab w:pos="720" w:val="right" w:leader="dot"/></w:tabs>';
const rPr = '<w:b/><w:i w:val="0"/><w:color w:val="123456"/>';
const alternate = (selected: string, fallback = "", requires = "w") => `<mc:AlternateContent><mc:Choice Requires="${requires}">${selected}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`;
const style = (properties: string) => `<w:style w:type="paragraph" w:styleId="Original"><w:name w:val="Original"/>${properties}</w:style>`;
const fixtures = [
  { name: "direct control", xml: style(`<w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr>`) },
  { name: "selected properties", xml: style(`<w:pPr>${alternate(pPr)}</w:pPr><w:rPr>${alternate(rPr)}</w:rPr>`) },
  { name: "fallback properties", xml: style(`<w:pPr>${alternate('<w:jc w:val="right"/>', pPr, "f")}</w:pPr><w:rPr>${alternate('<w:b w:val="0"/>', rPr, "f")}</w:rPr>`) },
  { name: "selected containers", xml: style(alternate(`<w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr>`)) },
  { name: "selected definition", xml: alternate(style(`<w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr>`), style('<w:rPr><w:b w:val="0"/></w:rPr>')) },
  { name: "inherited ProcessContent", xml: style(`<w:pPr><f:pass>${pPr}</f:pass></w:pPr><w:rPr><f:pass>${rPr}</f:pass></w:rPr>`) },
  { name: "ancestor ProcessContent", xml: `<f:pass>${style(`<w:pPr><f:pass>${pPr}</f:pass></w:pPr><w:rPr><f:pass>${rPr}</f:pass></w:rPr>`)}</f:pass>` }
];

for (const strict of [false, true]) for (const route of ["model", "batch", "sdk", "cli"] as const) it.each(fixtures)(
  `${strict ? "Strict" : "Transitional"} ${route} reads style $name without rewriting the package`,
  async ({ xml }) => {
    const input = await textFixture('<w:p><w:r><w:t>Original text</w:t></w:r></w:p>', {
      styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass">${xml}</w:styles>` }
    }, strict);
    if (route === "model") {
      const document = await Document(input, textContext);
      expect(document.styles.length).toBe(1);
      const selected = document.styles.at("Original");
      expect(selected).toBeInstanceOf(ParagraphStyle);
      const paragraph = selected as ParagraphStyle;
      expect(paragraph.font.element.localName).toBe("style");
      expect({ alignment: paragraph.paragraph_format.alignment?.name, keep: paragraph.paragraph_format.keep_with_next, bold: paragraph.font.bold, italic: paragraph.font.italic, color: paragraph.font.color.rgb?.toString() }).toEqual({ alignment: "CENTER", keep: true, bold: true, italic: false, color: "123456" });
      expect([...paragraph.paragraph_format.tab_stops].map(tab => [tab.position.twips, tab.alignment.name])).toEqual([[720, "RIGHT"]]);
      const volume = Volume.fromJSON({ "/out": "" });
      await document.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
      const saved = new Uint8Array(volume.readFileSync("/out") as Buffer);
      const before = await readArchive(input, textContext), after = await readArchive(saved, textContext);
      expect(after.members.map(member => [member.name, member.bytes])).toEqual(before.members.map(member => [member.name, member.bytes]));
      expect((await Document(saved, textContext)).styles.length).toBe(1);
    } else if (route === "batch") {
      const batch = { version: 1, operations: [
        { operation: "model.document.Document.styles.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "styles" },
        { operation: "model.styles.styles.Styles.__getitem__.call", receiver: { resultHandle: "styles" }, arguments: { key: "Original" }, resultHandle: "selected" },
        { operation: "model.styles.style.ParagraphStyle.paragraph_format.get", receiver: { resultHandle: "selected" }, arguments: {}, resultHandle: "format" },
        { operation: "model.text.parfmt.ParagraphFormat.alignment.get", receiver: { resultHandle: "format" }, arguments: {} }
      ] };
      const result = await applyStyleModelBatch(input, batch, textContext);
      expect(result.affected).toBe(0);
      expect(result.results.at(-1)?.value).toEqual({ enum: "WD_PARAGRAPH_ALIGNMENT", name: "CENTER" });
      const volume = Volume.fromJSON({ "/out": "", "/err": "" });
      const cli = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: ["batch", "/input.docx", "--ops-json", JSON.stringify(batch), "--dry-run", "--json"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
        filesystem: { async readFile() { return input; } }, stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(cli.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
      const envelope = JSON.parse(volume.readFileSync("/out", "utf8") as string);
      expect(envelope.affected).toBe(0);
      expect(envelope.data.results.at(-1).value).toEqual({ enum: "WD_PARAGRAPH_ALIGNMENT", name: "CENTER" });
    } else if (route === "sdk") {
      const result = await inspectDocumentStyles(input, { name: "Original" }, textContext);
      expect(result.styles).toHaveLength(1);
      expect(result.styles[0]?.direct).toMatchObject({ alignment: "center", keepWithNext: true, bold: true, italic: false, color: "123456", tabStops: [{ position: 36, alignment: "right", leader: "dot" }] });
    } else {
      const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/out": "", "/err": "" });
      const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: ["styles", "get", "/input.docx", "--name", "Original", "--json"].map(word => new TextEncoder().encode(word)),
        cwd: "/", signal: textContext.signal,
        filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } },
        stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
      const envelope = JSON.parse(volume.readFileSync("/out", "utf8") as string);
      expect(envelope.affected).toBe(0);
      expect(envelope.data.styles[0].direct).toMatchObject({ alignment: "center", bold: true, italic: false });
      expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
    }
  }
);

for (const strict of [false, true]) for (const route of ["sdk", "cli"] as const) it(`rejects affected ${strict ? "Strict" : "Transitional"} latent-default edits through ${route} without output`, async () => {
  const input = await textFixture('<w:p/>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="${mc}">${alternate('<w:latentStyles w:defLockedState="1"/>')}</w:styles>` } }, strict);
  const volume = Volume.fromJSON({ "/out": "", "/err": "" });
  if (route === "sdk") await expect(editDocumentStyles(input, { operation: "styles.latent.defaults.set", defaultToLocked: false, output: "-" }, {
    ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }
  })).rejects.toMatchObject({ code: "unsupported-edit" });
  else {
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: ["styles", "latent", "defaults", "set", "/input.docx", "--default-to-locked", "false", "--output", "-"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
      filesystem: { async readFile() { return input; } }, stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
    });
    expect(result.exitCode).toBe(1);
    expect(volume.readFileSync("/err", "utf8")).toContain("unsupported-edit");
  }
  expect(volume.readFileSync("/out")).toHaveLength(0);
});

for (const strict of [false, true]) for (const kind of ["metadata", "latent container", "latent entry"] as const) for (const route of ["model", "sdk", "cli"] as const) it(
  `reads ${strict ? "Strict" : "Transitional"} selected ${kind} through ${route}`,
  async () => {
    const metadata = '<w:name w:val="Selected Name"/><w:basedOn w:val="Base"/><w:next w:val="Base"/><w:uiPriority w:val="0"/><w:semiHidden/><w:locked/><w:qFormat/><w:unhideWhenUsed/>';
    const entry = '<w:lsdException w:name="Latent Original" w:semiHidden="1" w:qFormat="0" w:uiPriority="0"/>';
    const latent = `<w:latentStyles w:defLockedState="1" w:count="42">${kind === "latent entry" ? alternate(entry) : entry}</w:latentStyles>`;
    const source = `<w:styles xmlns:w="${w}" xmlns:mc="${mc}">${kind === "metadata" ? `<w:style w:type="paragraph" w:styleId="Base"><w:name w:val="Base"/></w:style><w:style w:type="paragraph" w:styleId="Selected">${alternate(metadata)}</w:style>` : kind === "latent container" ? alternate(latent) : latent}</w:styles>`;
    const input = await textFixture('<w:p/>', { styles: { kind: "styles", xml: source } }, strict);
    if (route === "model") {
      const doc = await Document(input, textContext), before = doc.styles.element.serialize();
      if (kind === "metadata") {
        const selected = doc.styles.at("Selected Name") as ParagraphStyle;
        expect({ name: selected.name, base: selected.base_style?.style_id, next: selected.next_paragraph_style.style_id, priority: selected.priority, hidden: selected.hidden, locked: selected.locked, quick: selected.quick_style, unhide: selected.unhide_when_used }).toEqual({ name: "Selected Name", base: "Base", next: "Base", priority: 0, hidden: true, locked: true, quick: true, unhide: true });
      } else {
        const latent = doc.styles.latent_styles, entry = latent.at("Latent Original");
        expect(latent.length).toBe(1);
        expect([latent.default_to_locked, latent.load_count, entry.hidden, entry.quick_style, entry.priority]).toEqual([true, 42, true, false, 0]);
        expect(latent.element.localName).toBe("latentStyles");
        expect(entry.element.localName).toBe("lsdException");
        for (const action of [
          () => { entry.hidden = false; },
          () => { entry.delete(); },
          ...(kind === "latent container" ? [() => { latent.add_latent_style("New Original"); }] : []),
          () => { latent.default_to_locked = false; }
        ]) {
          expect(action).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
          expect(latent.length).toBe(1);
          expect(entry.name).toBe("Latent Original");
          expect(doc.styles.element.serialize()).toEqual(before);
        }
      }
      expect(doc.styles.element.serialize()).toEqual(before);
    } else {
      let data;
      if (route === "sdk") data = await inspectDocumentStyles(input, {}, textContext);
      else {
        const volume = Volume.fromJSON({ "/out": "", "/err": "" });
        const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
          args: ["styles", "list", "/input.docx", "--json"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
          filesystem: { async readFile() { return input; } }, stdin: { async *[Symbol.asyncIterator]() {} },
          stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
        });
        expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
        const envelope = JSON.parse(volume.readFileSync("/out", "utf8") as string);
        expect(envelope.affected).toBe(0);
        data = envelope.data;
      }
      if (kind === "metadata") expect(data.styles[1]).toMatchObject({ name: "Selected Name", base: "Base", next: "Base", priority: 0, hidden: true, locked: true, quickStyle: true, unhideWhenUsed: true });
      else expect(data.latent).toMatchObject({ defaults: { defaultToLocked: true, loadCount: 42 }, entries: [{ name: "Latent Original", hidden: true, quickStyle: false, priority: 0 }] });
    }
  }
);

for (const strict of [false, true]) it.each(fixtures.filter(fixture => fixture.name !== "direct control"))(
  `retains ${strict ? "Strict" : "Transitional"} style $name on protected formatting edits`,
  async ({ xml }) => {
    const input = await textFixture('<w:p/>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass">${xml}</w:styles>` } }, strict);
    const doc = await Document(input, textContext), selected = doc.styles.at("Original") as ParagraphStyle;
    const before = doc.styles.element.serialize(), format = selected.paragraph_format, font = selected.font, tabs = format.tab_stops, tab = tabs.at(0);
    for (const action of [
      () => { format.alignment = WD_ALIGN_PARAGRAPH.LEFT; },
      () => { font.bold = false; },
      () => { tab.position = Twips(1440); },
      () => { tabs.remove(0); },
      () => { tabs.clear_all(); },
      () => { tabs.add_tab_stop(Twips(1440)); },
      () => { tab.element.set_attribute({ namespaceURI: tab.element.namespace, localName: "pos" }, "1440"); }
    ]) {
      expect(action).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
      expect(doc.styles.element.serialize()).toEqual(before);
      expect(format.alignment?.name).toBe("CENTER");
      expect(font.bold).toBe(true);
      expect(tab.position.twips).toBe(720);
    }
  }
);

it("keeps repeated style formatting reads bounded and cancellable", async () => {
  const source = `<w:styles xmlns:w="${w}">${Array.from({ length: 100 }, (_, index) => `<w:style w:type="paragraph" w:styleId="Original${index}"><w:name w:val="Original ${index}"/><w:rPr><w:b/></w:rPr></w:style>`).join("")}</w:styles>`;
  const input = await textFixture('<w:p/>', { styles: { kind: "styles", xml: source } });
  const controller = new AbortController(), budget = new DocumentBudget({ retainedBytes: 4 * 1024 * 1024 }, controller.signal);
  const doc = await Document(input, { ...textContext, budget, signal: controller.signal });
  const fonts = [...doc.styles].map(style => (style as ParagraphStyle).font);
  expect(fonts.map(font => font.bold)).toEqual(Array(100).fill(true));
  const before = budget.usage;
  for (let i = 0; i < 100; i++) expect(fonts[0]!.bold).toBe(true);
  expect(budget.usage.retainedBytes).toBe(before.retainedBytes);
  expect(budget.usage.work).toBeGreaterThan(before.work);
  controller.abort();
  expect(() => fonts[0]!.bold).toThrow("cancelled");
});

for (const strict of [false, true]) it(`retains selected ${strict ? "Strict" : "Transitional"} style handles after removing an ordinary XML sibling`, async () => {
  const retained = alternate(style(`<w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr>`));
  const source = `<w:styles xmlns:w="${w}" xmlns:mc="${mc}">${retained}<w:style w:type="paragraph" w:styleId="Plain"><w:name w:val="Plain"/><w:rPr><w:b/></w:rPr></w:style></w:styles>`;
  const input = await textFixture('<w:p/>', { styles: { kind: "styles", xml: source } }, strict);
  const doc = await Document(input, textContext), selected = doc.styles.at("Original") as ParagraphStyle, plain = doc.styles.at("Plain") as ParagraphStyle;
  expect(plain.font.bold).toBe(true);
  const node = doc.styles.element.children.find(node => node.localName === "style")!;
  node.remove();
  expect(doc.styles.length).toBe(1);
  expect(selected.name).toBe("Original");
  expect(selected.font.bold).toBe(true);
  expect(() => plain.name).toThrowError(expect.objectContaining({ code: "stale-selection" }));
});

for (const strict of [false, true]) it(`retains selected ${strict ? "Strict" : "Transitional"} style handles after inserting an ordinary XML sibling`, async () => {
  const retained = alternate(style(`<w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr>`));
  const input = await textFixture('<w:p/>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="${mc}">${retained}</w:styles>` } }, strict);
  const doc = await Document(input, textContext), selected = doc.styles.at("Original") as ParagraphStyle;
  const namespaceURI = doc.styles.element.namespace;
  const node = doc.styles.element.insert(1, { kind: "element", name: { namespaceURI, localName: "style" }, attributes: [
    { name: { namespaceURI, localName: "type" }, value: "paragraph" }, { name: { namespaceURI, localName: "styleId" }, value: "Plain" }
  ], children: [{ kind: "element", name: { namespaceURI, localName: "name" }, attributes: [{ name: { namespaceURI, localName: "val" }, value: "Plain" }] }] });
  expect(doc.styles.length).toBe(2);
  expect(selected.name).toBe("Original");
  const plain = doc.styles.at("Plain");
  node.remove();
  expect(selected.font.bold).toBe(true);
  expect(() => plain.name).toThrowError(expect.objectContaining({ code: "stale-selection" }));
});

for (const strict of [false, true]) it(`saves an owned ${strict ? "Strict" : "Transitional"} plain-style formatting XML edit beside an alternate`, async () => {
  const retained = alternate(style(`<w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr>`));
  const source = `<w:styles xmlns:w="${w}" xmlns:mc="${mc}">${retained}<w:style w:type="paragraph" w:styleId="Plain"><w:name w:val="Plain"/><w:rPr><w:b/></w:rPr></w:style></w:styles>`;
  const input = await textFixture('<w:p/>', { styles: { kind: "styles", xml: source } }, strict);
  const doc = await Document(input, textContext), plain = doc.styles.at("Plain") as ParagraphStyle;
  const bold = plain.font.element.children.find(node => node.localName === "rPr")!.children[0]!;
  bold.set_attribute({ namespaceURI: bold.namespace, localName: "val" }, "0");
  expect(plain.font.bold).toBe(false);
  const volume = Volume.fromJSON({ "/out": "" });
  await doc.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
  const saved = new Uint8Array(volume.readFileSync("/out") as Buffer), reopened = await Document(saved, textContext);
  expect((reopened.styles.at("Plain") as ParagraphStyle).font.bold).toBe(false);
  expect((reopened.styles.at("Original") as ParagraphStyle).font.bold).toBe(true);
  const before = await readArchive(input, textContext), after = await readArchive(saved, textContext);
  for (const member of before.members) {
    const next = after.members.find(item => item.name === member.name)!;
    if (member.name === "word/styles.xml") expect(new TextDecoder().decode(next.bytes)).toContain(retained);
    else expect(next.bytes).toEqual(member.bytes);
  }
});

for (const strict of [false, true]) it(`resolves ${strict ? "Strict" : "Transitional"} selected defaults and style inheritance`, async () => {
  const source = `<w:styles xmlns:w="${w}" xmlns:mc="${mc}">${alternate('<w:docDefaults><w:rPrDefault><w:rPr><w:b/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="200"/></w:pPr></w:pPrDefault></w:docDefaults>')}<w:style w:type="paragraph" w:styleId="Base"><w:name w:val="Base"/><w:rPr>${alternate('<w:i/>')}</w:rPr></w:style><w:style w:type="paragraph" w:styleId="Detail"><w:name w:val="Detail"/>${alternate('<w:basedOn w:val="Base"/>')}<w:pPr>${alternate('<w:jc w:val="center"/>')}</w:pPr></w:style></w:styles>`;
  const input = await textFixture('<w:p/>', { styles: { kind: "styles", xml: source } }, strict);
  const info = await inspectDocumentStyles(input, { name: "Detail" }, textContext);
  expect(info.defaults.run.bold).toBe(true);
  expect(info.defaults.paragraph.spaceAfter).toBe(10);
  expect(info.styles[0]).toMatchObject({ base: "Base", direct: { bold: null, italic: null, alignment: "center" }, effective: { bold: true, italic: true, alignment: "center", spaceAfter: 10 } });
});

for (const strict of [false, true]) it(`keeps selected ${strict ? "Strict" : "Transitional"} latent entries after supported neighboring additions`, async () => {
  const retained = alternate('<w:lsdException w:name="Original Latent" w:semiHidden="1"/>');
  const input = await textFixture('<w:p/>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="${mc}"><w:latentStyles>${retained}</w:latentStyles></w:styles>` } }, strict);
  const doc = await Document(input, textContext), latent = doc.styles.latent_styles, selected = latent.at("Original Latent");
  const added = latent.add_latent_style("Ordinary Latent");
  expect(selected.name).toBe("Original Latent");
  expect(latent.length).toBe(2);
  const namespaceURI = latent.element.namespace;
  const node = latent.element.insert(1, { kind: "element", name: { namespaceURI, localName: "lsdException" }, attributes: [{ name: { namespaceURI, localName: "name" }, value: "Inserted Latent" }] });
  expect(added.name).toBe("Ordinary Latent");
  expect([...latent].map(entry => entry.name)).toEqual(["Original Latent", "Inserted Latent", "Ordinary Latent"]);
  node.remove();
  expect(selected.hidden).toBe(true);
  expect(added.name).toBe("Ordinary Latent");
});
