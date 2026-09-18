import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, applyStyleModelBatch, createDocxInspectionCommandEngine, editDocumentSections, inspectDocumentSections, openDocumentLocations, readArchive } from "./index.js";
import { paragraph, run, textContext, textFixture, w } from "../tests/fixtures/text.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const alternate = (selected: string, inactive: string) =>
  `<mc:AlternateContent xmlns:mc="${mc}"><mc:Choice Requires="w">${selected}</mc:Choice><mc:Fallback>${inactive}</mc:Fallback></mc:AlternateContent>`;
const properties = '<w:pgSz w:w="10000" w:h="15000"/>';
const section = `<w:sectPr>${properties}</w:sectPr>`;
const boundary = `<w:p><w:pPr>${section}</w:pPr>${run("First")}</w:p>`;

async function command(input: Uint8Array, args: string[]) {
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/stdout": "", "/stderr": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: args.map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes); } },
    stderr: { async write(bytes) { volume.appendFileSync("/stderr", bytes); } }
  });
  expect(result.exitCode, volume.readFileSync("/stderr", "utf8") as string).toBe(0);
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
  return new Uint8Array(volume.readFileSync("/stdout") as Buffer);
}

const cases = [
  { name: "selected boundary paragraph", body: alternate(boundary, paragraph("inactive")) + paragraph("Last") + section, paths: [[0, 0, 0, 0, 0, 0], [0, 2]], widths: [10000, 10000] },
  { name: "selected section in paragraph properties", body: `<w:p><w:pPr>${alternate(section, "<w:sectPr/>")}</w:pPr>${run("First")}</w:p>` + paragraph("Last") + section, paths: [[0, 0, 0, 0, 0, 0], [0, 2]], widths: [10000, 10000] },
  { name: "selected final section", body: paragraph("Last") + alternate(section, "<w:sectPr/>"), paths: [[0, 1, 0, 0]], widths: [10000] },
  { name: "selected geometry", body: paragraph("Last") + `<w:sectPr>${alternate(properties, '<w:pgSz w:w="500" w:h="600"/>')}</w:sectPr>`, paths: [[0, 1]], widths: [10000] }
];

for (const strict of [false, true]) for (const route of ["model", "sdk", "cli"] as const) it.each(cases)(
  `${strict ? "Strict" : "Transitional"} ${route} reads $name without flattening its physical location`,
  async ({ body, paths, widths }) => {
    const input = await textFixture(body, {}, strict);
    if (route === "model") {
      const document = await Document(input, textContext);
      expect([...document.sections].map(item => item.page_width?.twips ?? null)).toEqual(widths);
      return;
    }
    const data = route === "sdk" ? await inspectDocumentSections(input, {}, textContext) : await (async () => {
      const envelope = JSON.parse(new TextDecoder().decode(await command(input, ["sections", "list", "/input.docx", "--json"])));
      expect(envelope.affected).toBe(0);
      return envelope.data as Awaited<ReturnType<typeof inspectDocumentSections>>;
    })();
    expect(data.items.map(item => item.direct.pageWidth)).toEqual(widths);
    expect(data.items.map(item => item.location.value.path)).toEqual(paths);
    const locations = await openDocumentLocations(input, textContext);
    expect(locations.list("section").map(item => item.value.path)).toEqual(paths);
    for (const item of data.items) expect(locations.resolve(item.location.token, "section")).toEqual(item.location);
  }
);

for (const strict of [false, true]) it(`reads selected story bindings and page policy without creating parts (${strict})`, async () => {
  const input = await textFixture(paragraph("Body") + `<w:sectPr>${alternate('<w:headerReference w:type="default" r:id="heading"/>', '<w:headerReference w:type="default" r:id="inactive"/>')}${properties}</w:sectPr>`, {
    heading: { kind: "header", xml: `<w:hdr xmlns:w="${w}">${paragraph("Selected header")}</w:hdr>` },
    inactive: { kind: "header", xml: `<w:hdr xmlns:w="${w}">${paragraph("Inactive header")}</w:hdr>` },
    settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}">${alternate("<w:evenAndOddHeaders/>", '<w:evenAndOddHeaders w:val="0"/>')}</w:settings>` }
  }, strict);
  const document = await Document(input, textContext);
  const original = document.element.serialize();
  expect(document.sections[0]!.header.is_linked_to_previous).toBe(false);
  expect(document.sections[0]!.header.paragraphs.map(p => p.text)).toEqual(["Selected header"]);
  expect(document.settings.odd_and_even_pages_header_footer).toBe(true);
  expect(document.element.serialize()).toEqual(original);
  const info = await inspectDocumentSections(input, {}, textContext);
  expect(info.evenAndOddHeaders).toBe(true);
  expect(info.items[0]!.headers.default).toEqual({ linkedToPrevious: false, sourceSection: 1, part: "/word/heading.xml" });
  const cli = JSON.parse(new TextDecoder().decode(await command(input, ["sections", "list", "/input.docx", "--json"])));
  expect(cli.data).toEqual(info);
});

for (const strict of [false, true]) for (const route of ["sdk", "cli"]) it(`${route} preserves selected and inactive sections while editing a plain neighbor (${strict})`, async () => {
  const retained = alternate(boundary, `<w:p><w:pPr><w:sectPr><w:pgSz w:w="7000" w:h="8000"/></w:sectPr></w:pPr>${run("Inactive")}</w:p>`);
  const input = await textFixture(retained + paragraph("Last") + section, {}, strict);
  const volume = Volume.fromJSON({ "/out": "", "/selected": "" });
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } } };
  let output: Uint8Array;
  if (route === "sdk") {
    const result = await editDocumentSections(input, { operation: "sections.set", options: { section: 2, orientation: { enum: "WD_ORIENTATION", name: "LANDSCAPE" }, output: "-" } }, context);
    expect(result.changed).toBe(true);
    expect(result.changes).toHaveLength(1);
    output = new Uint8Array(volume.readFileSync("/out") as Buffer);
  } else output = await command(input, ["sections", "set", "/input.docx", "--section", "2", "--orientation", "LANDSCAPE", "--output", "-"]);
  const info = await inspectDocumentSections(output, {}, textContext);
  expect(info.items.map(item => [item.direct.orientation, item.direct.pageWidth])).toEqual([["portrait", 10000], ["landscape", 10000]]);
  const before = await readArchive(input, textContext), after = await readArchive(output, textContext);
  for (const member of before.members) {
    const next = after.members.find(item => item.name === member.name)!;
    if (member.name !== "word/document.xml") expect(next.bytes).toEqual(member.bytes);
    else expect(new TextDecoder().decode(next.bytes)).toContain(retained);
  }
  const selectedOutput = route === "sdk" ? await (async () => {
    const changed = await editDocumentSections(input, { operation: "sections.set", options: { section: 1, orientation: { enum: "WD_ORIENTATION", name: "LANDSCAPE" }, output: "-" } }, {
      ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/selected", bytes); } }
    });
    expect(changed.changed).toBe(true);
    return new Uint8Array(volume.readFileSync("/selected") as Buffer);
  })() : await command(input, ["sections", "set", "/input.docx", "--section", "1", "--orientation", "LANDSCAPE", "--output", "-"]);
  const selectedInfo = await inspectDocumentSections(selectedOutput, {}, textContext);
  expect(selectedInfo.items.map(item => [item.direct.orientation, item.direct.pageWidth])).toEqual([["landscape", 10000], ["portrait", 10000]]);
  expect(selectedInfo.items.map(item => item.location.value.path)).toEqual(info.items.map(item => item.location.value.path));
  const selectedArchive = await readArchive(selectedOutput, textContext);
  expect(selectedArchive.members.map(member => member.name)).toEqual(before.members.map(member => member.name));
  for (const member of before.members) {
    const next = selectedArchive.members.find(item => item.name === member.name)!;
    if (member.name !== "word/document.xml") expect(next.bytes).toEqual(member.bytes);
    else {
      const source = new TextDecoder().decode(member.bytes), changed = new TextDecoder().decode(next.bytes);
      const start = source.indexOf(section), end = start + section.length;
      expect(changed.startsWith(source.slice(0, start))).toBe(true);
      expect(changed.endsWith(source.slice(end))).toBe(true);
    }
  }
});

for (const strict of [false, true]) for (const route of ["model", "sdk", "cli"]) for (const selected of [false, true]) it(`${route} retains a header relationship used by an ${selected ? "active" : "inactive"} alternative after unlinking a plain section (${strict})`, async () => {
  const reference = '<w:headerReference w:type="default" r:id="heading"/>';
  const first = `<w:p><w:pPr><w:sectPr>${reference}${properties}</w:sectPr></w:pPr>${run("First")}</w:p>`;
  const wrapped = alternate(selected ? reference : "", selected ? "" : reference);
  const input = await textFixture(first + paragraph("Last") + `<w:sectPr>${wrapped}${properties}</w:sectPr>`, {
    heading: { kind: "header", xml: `<w:hdr xmlns:w="${w}">${paragraph("Retained header")}</w:hdr>` }
  }, strict);
  const volume = Volume.fromJSON({ "/out": "" });
  const operations = [
    { operation: "model.document.Document.sections.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "sections" },
    { operation: "model.section.Section.header.get", receiver: { resultHandle: "sections", index: 0 }, arguments: {}, resultHandle: "header" },
    { operation: "model.section._Header.is_linked_to_previous.set", receiver: { resultHandle: "header" }, arguments: { value: true } }
  ];
  const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  let output: Uint8Array;
  if (route === "cli") output = await command(input, ["batch", "/input.docx", "--ops-json", JSON.stringify({ version: 1, operations }), "--output", "-"]);
  else {
    if (route === "model") {
      const document = await Document(input, textContext);
      document.sections[0]!.header.is_linked_to_previous = true;
      expect(document.sections[0]!.header.is_linked_to_previous).toBe(true);
      await document.save(sink);
    } else {
      const result = await applyStyleModelBatch(input, { version: 1, operations }, textContext);
      expect(result.affected).toBe(1);
      await result.save(sink);
    }
    output = new Uint8Array(volume.readFileSync("/out") as Buffer);
  }
  const before = await readArchive(input, textContext), after = await readArchive(output, textContext);
  for (const member of before.members.filter(item => item.name !== "word/document.xml"))
    expect(after.members.find(item => item.name === member.name)?.bytes).toEqual(member.bytes);
  expect(new TextDecoder().decode(after.members.find(item => item.name === "word/document.xml")!.bytes)).toContain(wrapped);
  const reloaded = await Document(output, textContext);
  expect(reloaded.sections[1]!.header.is_linked_to_previous).toBe(!selected);
  if (selected) expect(reloaded.sections[1]!.header.paragraphs[0]!.text).toBe("Retained header");
});
