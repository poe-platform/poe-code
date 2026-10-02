import { expect, it } from "vitest";
import { Volume } from "memfs";
import { replacementFixture } from "../tests/fixtures/image-replacement.js";
import * as docx from "./index.js";
import { paragraph, run, textContext, textFixture, w } from "../tests/fixtures/text.js";

async function generate(body: string, options: Partial<docx.DummyTextOptions> = {}) {
  const input = await textFixture(body);
  const volume = Volume.fromJSON({ "/out": "" });
  const data = await docx.setDocumentDummyText(input, { seed: 1, all: true, output: "-", ...options }, {
    ...textContext, encoding: { order: "input", compression: "store" },
    stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }
  });
  const bytes = new Uint8Array(volume.readFileSync("/out") as Buffer);
  const text = await docx.extractDocumentText(bytes, textContext);
  const xml = new TextDecoder().decode(await docx.getDocumentXml(bytes, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array);
  return { input, bytes, data, text, xml };
}

it("repeats seeded output byte for byte and restarts the sequence per paragraph", async () => {
  const body = paragraph("海岸 עברית é") + paragraph("two words");
  const first = await generate(body), second = await generate(body);
  expect(first.bytes).toEqual(second.bytes);
  expect(first.text.text).toBe("birch cedar delta\nbirch cedar");
  expect((await generate(body, { seed: -1 })).text.text).toBe("heath amber birch\nheath amber");
  expect((await generate(body, { seed: 4294967297 })).bytes).toEqual(first.bytes);
});

it("keeps run formatting, instructions, tabs, breaks and nontext markup", async () => {
  const body = `<w:p><w:r><w:rPr><w:b/><w:lang w:val="he"/></w:rPr><w:t>海</w:t><w:tab/></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>岸</w:t><w:br/><w:fldChar w:fldCharType="begin"/><w:instrText> MERGEFIELD Secret </w:instrText><w:fldChar w:fldCharType="separate"/><w:t>cache</w:t><w:fldChar w:fldCharType="end"/><w:drawing/><w:t> tail</w:t></w:r></w:p>`;
  const result = await generate(body);
  for (const retained of ['<w:rPr><w:b/><w:lang w:val="he"/></w:rPr>', '<w:rPr><w:i/></w:rPr>', '<w:tab/>', '<w:br/>', '<w:instrText> MERGEFIELD Secret </w:instrText>', '<w:drawing/>']) expect(result.xml).toContain(retained);
  expect(result.text.text.replaceAll("\t", "").replaceAll("\n", "")).toBe("birch cedar delta elm");
});

it("honors a checked scalar range and leaves neighboring text untouched", async () => {
  const body = paragraph("🌊海 coast tail") + paragraph("untouched");
  const locations = await docx.openDocumentLocations(await textFixture(body), textContext);
  const select = locations.range(locations.at("paragraph", 1).token, 1, 8).token;
  const result = await generate(body, { all: undefined, select });
  expect(result.text.text).toBe("🌊birch cedar tail\nuntouched");
});

it("treats zero computed words as no change and supports explicit counts", async () => {
  expect((await generate('<w:p/>' + paragraph("   "))).data).toMatchObject({ changed: false, changes: [] });
  expect((await generate(paragraph("one"), { words: 3 })).text.text).toBe("birch cedar delta");
  expect((await generate('<w:p/>', { words: 2 })).text.text).toBe("birch cedar");
});

it("requires seed and selection and refuses unsafe selected content", async () => {
  for (const options of [{ seed: undefined }, { seed: 0.5 }, { words: 0 }, { all: undefined }]) await expect(generate(paragraph("one"), options as Partial<docx.DummyTextOptions>)).rejects.toBeDefined();
  await expect(generate(`<w:p><w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>${run("reserved")}</w:sdtContent></w:sdt></w:p>`)).rejects.toMatchObject({ code: "unsupported-edit" });
  await expect(generate(paragraph("different"), { all: undefined, paragraph: 2 })).rejects.toMatchObject({ code: "missing-selection" });
});

it("retains every unselected package member including hidden metadata and image bytes", async () => {
  const imageFixture = await replacementFixture(1);
  const metadata = Volume.fromJSON({ "/out": "" });
  await docx.editDocumentProperties(imageFixture, { operation: "properties.set", name: "title", value: "Private source identity", output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { metadata.appendFileSync("/out", bytes); } } });
  const fixture = new Uint8Array(metadata.readFileSync("/out") as Buffer);
  const volumeForInput = Volume.fromJSON({ "/out": "" });
  const original = await docx.readDocumentArchive(fixture, textContext);
  const editor = new docx.DocumentArchiveEditor(original);
  const xml = editor.xml("word/document.xml");
  const body = xml.root.children.find(child => child.localName === "body")!;
  xml.insertChildren(body, `<w:p xmlns:w="${w}"><w:r><w:t>海 岸</w:t></w:r></w:p>`, body.children[0]);
  const authored = editor.snapshot();
  await docx.writeArchive(authored, { async write(bytes) { volumeForInput.appendFileSync("/out", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volumeForInput.readFileSync("/out") as Buffer);
  const archive = await docx.readDocumentArchive(input, textContext);
  const volume = Volume.fromJSON({ "/out": "" });
  await docx.setDocumentDummyText(input, { seed: 0, paragraph: 1, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
  const output = await docx.readDocumentArchive(new Uint8Array(volume.readFileSync("/out") as Buffer), textContext);
  expect(archive.members.some(m => m.name.startsWith("word/media/"))).toBe(true);
  expect((await docx.inspectDocumentProperties(input, { name: "title" }, textContext)).items[0]!.properties[0]!.value).toBe("Private source identity");
  expect(output.members.filter(m => m.name !== "word/document.xml")).toEqual(archive.members.filter(m => m.name !== "word/document.xml"));
});

it("rejects generation and receipt limits before publication", async () => {
  for (const options of [{ words: Number.MAX_SAFE_INTEGER }, { limit: [{ name: "matches" as const, value: 0 }] }, { limit: [{ name: "serializedOutput" as const, value: 1 }] }]) await expect(generate(paragraph("one two"), options)).rejects.toMatchObject({ code: "limit-exceeded" });
});

it("exposes matching CLI JSON, seed validation, schema and capabilities", async () => {
  const input = await textFixture(paragraph("one two"));
  for (const [flags, status] of [[["--seed", "1", "--paragraph", "1"], 0], [["--paragraph", "1"], 2], [["--seed", "1"], 2], [["--seed", "1", "--all", "--limit", "matches=0"], 4]] as const) {
    let stdout = "";
    const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["lorem", "set", "report.docx", ...flags, "--dry-run", "--json"].map(x => new TextEncoder().encode(x)), cwd: "/", signal: textContext.signal,
      filesystem: { async readFile() { return input; } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} } });
    expect(result.exitCode).toBe(status);
    expect(JSON.parse(stdout)).toMatchObject({ version: 1, operation: "lorem.set", ok: status === 0, affected: status === 0 ? 1 : 0 });
  }
  const discovery = (...args: string[]) => docx.getDocxDiscovery(docx.parseDocxArguments(args.map(x => new TextEncoder().encode(x))))!;
  expect(discovery("schema", "lorem", "set").data).toMatchObject({ operations: [{ id: "lorem.set", support: "edit", featureIds: ["F45"] }] });
  expect(discovery("help", "lorem", "set").human).toContain("not anonymization");
  expect(discovery("capabilities").data).toMatchObject({ features: expect.arrayContaining([expect.objectContaining({ id: "F45", level: "edit" })]) });
});

it("isolates explicit word counts to the selected paragraph and guards stale tokens", async () => {
  const body = paragraph("selected") + '<w:p/>' + paragraph("retained");
  expect((await generate(body, { all: undefined, paragraph: 1, words: 2 })).text.text).toBe("birch cedar\n\nretained");
  const locations = await docx.openDocumentLocations(await textFixture(paragraph("earlier")), textContext);
  await expect(generate(body, { all: undefined, select: locations.at("paragraph", 1).token })).rejects.toMatchObject({ code: "stale-selection" });
});

it("handles an empty story and refuses an explicit count with no target", async () => {
  expect((await generate('', { scope: "body" })).data).toMatchObject({ changed: false, changes: [] });
  await expect(generate('', { words: 2 })).rejects.toMatchObject({ code: "missing-selection" });
  expect((await generate('', { words: 2, allowEmpty: true })).data.changed).toBe(false);
});
