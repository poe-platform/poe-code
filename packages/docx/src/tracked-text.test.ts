import { expect, it } from "vitest";
import { Volume } from "memfs";
import { DocumentBudget, createDocxInspectionCommandEngine, extractDocumentText, openDocumentLocations, replaceDocumentText, getDocumentXml } from "./index.js";
import { paragraph, run, textContext, textFixture } from "../tests/fixtures/text.js";

const metadata = { author: "Mira & Bay", timestamp: "2025-02-03T04:05:06Z" };
it("executes explicit tracked insertion through the existing command engine", async () => {
  const input = await textFixture(paragraph("Bay"));
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["revisions", "add", "/input", "--kind", "insert", "--text", "Pier", "--paragraph", "1", "--author", metadata.author, "--timestamp", metadata.timestamp, "--output", "-"].map(value => new TextEncoder().encode(value)),
    cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(0);
  expect((await extractDocumentText(new Uint8Array(volume.readFileSync("/out") as Buffer), textContext)).text).toBe("BayPier");
});
async function revisionEdit(input: Uint8Array, options: Record<string, unknown>) {
  const module = await import("./revision-edit.js");
  const volume = Volume.fromJSON({ "/out": "" });
  await module.editDocumentRevisions(input, { ...metadata, ...options, output: "-" } as never,
    { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}

it("inserts at a Unicode scalar caret retaining exact original and final views", async () => {
  const input = await textFixture(paragraph("A🌊B"));
  const document = await openDocumentLocations(input, textContext);
  const output = await revisionEdit(input, { kind: "insert", text: "Pier", select: document.range(document.at("paragraph", 1).token, 2, 2).token });
  expect((await extractDocumentText(output, textContext, { view: "original" })).text).toBe("A🌊B");
  expect((await extractDocumentText(output, textContext)).text).toBe("A🌊PierB");
});

it("deletes across differently formatted runs without discarding the old properties", async () => {
  const input = await textFixture('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Harbor</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t> Coast</w:t></w:r></w:p>');
  const document = await openDocumentLocations(input, textContext);
  const output = await revisionEdit(input, { kind: "delete", select: document.range(document.at("paragraph", 1).token, 3, 9).token });
  expect((await extractDocumentText(output, textContext, { view: "original" })).text).toBe("Harbor Coast");
  expect((await extractDocumentText(output, textContext)).text).toBe("Harast");
  const xml = new TextDecoder().decode(await getDocumentXml(output, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array);
  expect(xml).toContain("delText");
  expect(xml).toContain("<w:b/>");
  expect(xml).toContain("<w:i/>");
});

it("tracks multiple replacement matches in one run with deleted then inserted order", async () => {
  const input = await textFixture(paragraph("Bay Bay"));
  const volume = Volume.fromJSON({ "/out": "" });
  await replaceDocumentText(input, { find: "Bay", with: "Pier", all: true, trackChanges: true, ...metadata, output: "-" } as never,
    { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer);
  expect((await extractDocumentText(output, textContext, { view: "original" })).text).toBe("Bay Bay");
  expect((await extractDocumentText(output, textContext)).text).toBe("Pier Pier");
  expect((await extractDocumentText(output, textContext, { view: "all" })).text).toBe("BayPier BayPier");
});

it("rejects tracked creation within existing review before output", async () => {
  const input = await textFixture(`<w:p><w:ins w:id="7">${run("Harbor")}</w:ins></w:p>`);
  await expect(revisionEdit(input, { kind: "delete", paragraph: 1 })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("preserves unrelated review bytes and reserves their lexical identities", async () => {
  const review = `<w:ins w:id="01">${run("Old ")}</w:ins>`;
  const input = await textFixture(`<w:p>${review}${run("Bay")}</w:p>`);
  const volume = Volume.fromJSON({ "/out": "" });
  await replaceDocumentText(input, { find: "Bay", with: "Pier", all: true, trackChanges: true, ...metadata, output: "-" } as never,
    { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer);
  expect((await extractDocumentText(output, textContext, { view: "original" })).text).toBe("Bay");
  expect((await extractDocumentText(output, textContext)).text).toBe("Old Pier");
  expect(new TextDecoder().decode(await getDocumentXml(output, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array)).toContain(review);
});

it.each(["futureChange", "del"])("tracks an ordinary run after unrelated %s markup", async kind => {
  const review = `<w:${kind} w:id="10" w:author="Mira">${run("Hidden")}</w:${kind}>`;
  const input = await textFixture(`<w:p>${review}${run("Coast")}</w:p>`);
  const volume = Volume.fromJSON({ "/out": "" });
  await replaceDocumentText(input, { find: "Coast", with: "Shore", all: true, trackChanges: true, ...metadata, output: "-" } as never,
    { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer);
  expect((await extractDocumentText(output, textContext)).text).toBe("Shore");
  expect(new TextDecoder().decode(await getDocumentXml(output, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array)).toContain(review);
});

it("preserves carriage-return scalars in retained and deleted text", async () => {
  const input = await textFixture('<w:p><w:r><w:t>A&#13;Coast</w:t></w:r></w:p>');
  const volume = Volume.fromJSON({ "/out": "" });
  await replaceDocumentText(input, { find: "Coast", with: "Shore", all: true, trackChanges: true, ...metadata, output: "-" } as never,
    { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer);
  expect((await extractDocumentText(output, textContext, { view: "original" })).text).toBe("A\rCoast");
  expect((await extractDocumentText(output, textContext)).text).toBe("A\rShore");
});

it("admits the complete revision result envelope before publication", async () => {
  const module = await import("./revision-edit.js");
  const input = await textFixture(Array.from({ length: 20 }, () => paragraph("Bay")).join(""));
  const options = { kind: "insert", text: "Pier", all: true, ...metadata, dryRun: true } as const;
  const data = await module.editDocumentRevisions(input, options, { ...textContext, encoding: { order: "input", compression: "store" } });
  const size = new TextEncoder().encode(JSON.stringify({ version: 1, operation: "revisions.add", ok: true, data, affected: data.changes.length, locations: data.changes.map(change => change.after), warnings: [], errors: [] }) + "\n").length;
  await expect(module.editDocumentRevisions(input, options, { ...textContext, budget: new DocumentBudget({ serializedOutput: size - 1 }, textContext.signal), encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "limit-exceeded" });
});

it("reserves signed lexical review IDs in inactive compatibility content", async () => {
  const input = await textFixture(`${paragraph("Bay")}<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:original:unavailable"><mc:Choice Requires="x"><w:p><w:futureChange w:id="+01" w:author="Mira">${run("Hidden")}</w:futureChange></w:p></mc:Choice><mc:Fallback>${paragraph("Coast")}</mc:Fallback></mc:AlternateContent>`);
  const output = await revisionEdit(input, { kind: "insert", text: "Pier", paragraph: 1 });
  const xml = new TextDecoder().decode(await getDocumentXml(output, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array);
  expect(xml).toContain('rt:id="2"');
  expect(xml).toContain('w:id="+01"');
  expect((await extractDocumentText(output, textContext)).text).toBe("BayPier\nCoast");
});

it("appends into an empty paragraph and deletes tabs and breaks reversibly", async () => {
  const empty = await textFixture('<w:p/>');
  const inserted = await revisionEdit(empty, { kind: "insert", text: "Pier", paragraph: 1 });
  expect((await extractDocumentText(inserted, textContext)).text).toBe("Pier");
  const input = await textFixture('<w:p><w:r><w:t>Bay</w:t><w:tab/><w:t>Coast</w:t><w:br/><w:t>Pier</w:t></w:r></w:p>');
  const output = await revisionEdit(input, { kind: "delete", paragraph: 1 });
  expect((await extractDocumentText(output, textContext, { view: "original" })).text).toBe("Bay\tCoast\nPier");
  expect((await extractDocumentText(output, textContext)).text).toBe("");
});

it("refuses tracked replacement in an enclosing complex body field", async () => {
  const input = await textFixture('<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>QUOTE</w:instrText><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Bay</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>');
  await expect(replaceDocumentText(input, { find: "Bay", with: "Shore", all: true, trackChanges: true, ...metadata, dryRun: true }, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "unsupported-edit" });
});
