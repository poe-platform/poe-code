import { expect, it } from "vitest";
import { Volume } from "memfs";
import { DocumentBudget, createDocxInspectionCommandEngine, extractDocumentText, getDocumentXml, inspectDocumentRevisions, openDocumentLocations, replaceDocumentText } from "./index.js";
import { paragraph, run, textContext, textFixture } from "../tests/fixtures/text.js";

const encoding = { order: "input", compression: "store" } as const;
async function decide(input: Uint8Array, operation: "revisions.accept" | "revisions.reject", options: Record<string, unknown> = {}) {
  const volume = Volume.fromJSON({ "/out": "" });
  const module = await import("./revision-decisions.js");
  const result = await module.editDocumentRevisionDecisions(input, { operation, options: { ...options, output: "-" } as never },
    { ...textContext, encoding, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
  return { result, bytes: new Uint8Array(volume.readFileSync("/out") as Buffer) };
}

it.each(["accept", "reject"])("executes supported text revision %s through the real command engine", async action => {
  const input = await textFixture(`<w:p>${run("A")}<w:ins w:id="1">${run("New")}</w:ins><w:del w:id="2"><w:r><w:delText>Old</w:delText></w:r></w:del></w:p>`);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["revisions", action, "/input", "--all", "--output", "-"].map(value => new TextEncoder().encode(value)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(0);
  expect((await extractDocumentText(new Uint8Array(volume.readFileSync("/out") as Buffer), textContext)).text).toBe(action === "accept" ? "ANew" : "AOld");
});

it.each(["accept", "reject"])("decides split-run tracked replacement by %s with faithful visible text", async action => {
  const input = await textFixture('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Harbor</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t> Coast</w:t></w:r></w:p>');
  const volume = Volume.fromJSON({ "/out": "" });
  await replaceDocumentText(input, { find: "bor Co", with: "Pier", all: true, trackChanges: true, author: "Mira", timestamp: "2025-02-03T04:05:06Z", output: "-" }, { ...textContext, encoding, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
  const tracked = new Uint8Array(volume.readFileSync("/out") as Buffer);
  const { bytes, result } = await decide(tracked, `revisions.${action}` as "revisions.accept", { all: true });
  const expected = action === "accept" ? "HarPierast" : "Harbor Coast";
  expect((await extractDocumentText(bytes, textContext)).text).toBe(expected);
  expect((await extractDocumentText(bytes, textContext, { view: "original" })).text).toBe(expected);
  expect(result.changes).toHaveLength(3);
  expect(result.changes.every(change => change.before.kind === "annotation" && change.after?.kind === "paragraph")).toBe(true);
});

it.each(["accept", "reject"])("decides direct formatting history by %s without merging old and current", async action => {
  const input = await textFixture('<w:p><w:pPr><w:pPrChange w:id="1"><w:pPr><w:bidi/></w:pPr></w:pPrChange></w:pPr><w:r><w:rPr><w:b/><w:rPrChange w:id="2"><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:t>Bay</w:t></w:r></w:p>');
  const { bytes } = await decide(input, `revisions.${action}` as "revisions.accept", { all: true });
  expect((await extractDocumentText(bytes, textContext)).segments[0]!.formatting).toMatchObject(action === "accept" ? { bold: true, italic: null, paragraph: { bidi: null } } : { bold: null, italic: true, paragraph: { bidi: true } });
});

it("preflights a mixed supported and unsupported selection before any stdout effect", async () => {
  const input = await textFixture(`<w:p><w:ins w:id="1">${run("Bay")}</w:ins><w:moveTo w:id="2">${run("Coast")}</w:moveTo></w:p>`);
  const volume = Volume.fromJSON({ "/out": "original" });
  const module = await import("./revision-decisions.js");
  await expect(module.editDocumentRevisionDecisions(input, { operation: "revisions.accept", options: { all: true, output: "-" } }, { ...textContext, encoding, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(volume.readFileSync("/out", "utf8")).toBe("original");
});

it("preserves namespace bindings supplied only by a removed revision wrapper", async () => {
  const input = await textFixture('<w:p><w:del xmlns:q="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:id="1"><q:r><q:delText>A&#13;Bay</q:delText></q:r></w:del></w:p>');
  const { bytes } = await decide(input, "revisions.reject", { revision: 1 });
  expect((await extractDocumentText(bytes, textContext)).text).toBe("A\rBay");
  expect(new TextDecoder().decode(await getDocumentXml(bytes, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array)).not.toContain("delText");
});

it("rejects a ranged token instead of treating it as a whole revision selection", async () => {
  const input = await textFixture(paragraph("Bay"));
  const document = await openDocumentLocations(input, textContext);
  await expect(decide(input, "revisions.accept", { select: document.range(document.at("paragraph", 1).token, 0, 1).token })).rejects.toMatchObject({ code: "usage" });
});

it.each([
  '<w:p><w:ins w:id="1"><w:del w:id="2"><w:r><w:delText>Bay</w:delText></w:r></w:del></w:ins></w:p>',
  '<w:p><w:pPr><w:rPr><w:del w:id="1"/></w:rPr></w:pPr><w:r><w:t>Bay</w:t></w:r></w:p>',
  '<w:p><w:r><w:rPr><w:color w:val="123456"/><w:rPrChange w:id="1"><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr><w:t>Bay</w:t></w:r></w:p>',
  '<w:p><w:ins w:id="1"><w:bookmarkStart w:id="2" w:name="dock"/><w:r><w:t>Bay</w:t></w:r><w:bookmarkEnd w:id="2"/></w:ins></w:p>',
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>QUOTE</w:instrText><w:fldChar w:fldCharType="separate"/></w:r><w:ins w:id="1"><w:r><w:t>Bay</w:t></w:r></w:ins><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
  '<w:p><w:moveToRangeStart w:id="2"/><w:ins w:id="1"><w:r><w:t>Bay</w:t></w:r></w:ins><w:moveToRangeEnd w:id="2"/></w:p>',
  '<w:p><w:del w:id="1"><w:r><w:delInstrText>Secret</w:delInstrText><w:delText>Bay</w:delText></w:r></w:del></w:p>'
])("refuses an unsupported review owner or protected boundary: %s", async body => {
  const input = await textFixture(body);
  await expect(decide(input, "revisions.reject", { all: true })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("keeps surrounding bookmarks and unrelated field bytes faithful", async () => {
  const field = '<w:fldSimple w:instr="QUOTE"><w:r><w:t>Field</w:t></w:r></w:fldSimple>';
  const input = await textFixture(`<w:p><w:bookmarkStart w:id="2" w:name="dock"/><w:ins w:id="1">${run("Bay")}</w:ins><w:bookmarkEnd w:id="2"/>${field}</w:p>`);
  const { bytes } = await decide(input, "revisions.accept", { revision: 1 });
  const xml = new TextDecoder().decode(await getDocumentXml(bytes, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array);
  expect(xml).toContain('<w:bookmarkStart w:id="2" w:name="dock"/>');
  expect(xml).toContain('<w:bookmarkEnd w:id="2"/>');
  expect(xml).toContain(field);
});

it("scopes revision ordinals and requires explicit empty handling on a fresh repeat", async () => {
  const input = await textFixture(`<w:p><w:ins w:id="1">${run("First")}</w:ins></w:p><w:p><w:ins w:id="2">${run("Second")}</w:ins></w:p>`);
  const { bytes } = await decide(input, "revisions.accept", { paragraph: 2, revision: 1 });
  expect(new TextDecoder().decode(await getDocumentXml(bytes, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array)).toContain('w:ins w:id="1"');
  const final = await decide(bytes, "revisions.accept", { all: true });
  await expect(decide(final.bytes, "revisions.accept", { all: true })).rejects.toMatchObject({ code: "missing-selection" });
  const repeated = await decide(final.bytes, "revisions.accept", { all: true, allowEmpty: true });
  expect(repeated.result).toMatchObject({ changed: false, changes: [] });
  expect(repeated.bytes).toEqual(final.bytes);
});

it.each(["accept", "reject"])("rejects unverified deletion-text elements inside an insertion before %s", async action => {
  const input = await textFixture('<w:p><w:ins w:id="1"><w:r><w:delText>Hidden</w:delText></w:r></w:ins></w:p>');
  await expect(decide(input, `revisions.${action}` as "revisions.accept", { revision: 1 })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it.each([
  '<w:ins w:id="2"><w:r><w:t>Coast</w:t></w:r></w:ins>',
  '<w:r><w:rPr><w:rPrChange w:id="2"><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:t>Coast</w:t></w:r>'
])("rejects a text or format decision overlapping a nested paragraph mark: %s", async reviewed => {
  const input = await textFixture(`<w:p><w:pPr><w:rPr><w:del w:id="1"/></w:rPr></w:pPr>${reviewed}</w:p>`);
  await expect(decide(input, "revisions.accept", { revision: 2 })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("selects a whole annotation token and rejects its stale reuse after publication", async () => {
  const input = await textFixture(`<w:p><w:ins w:id="1">${run("Bay")}</w:ins></w:p>`);
  const location = (await inspectDocumentRevisions(input, {}, textContext)).items[0]!.location;
  const { bytes, result } = await decide(input, "revisions.accept", { select: location.token });
  expect(result.changes[0]).toMatchObject({ before: location, after: { kind: "paragraph" }, revision: { id: "1" } });
  await expect(decide(bytes, "revisions.accept", { select: location.token })).rejects.toMatchObject({ code: "stale-selection" });
});

it("preserves owned input and output during dry-run, cancellation and sink failure", async () => {
  const input = await textFixture(`<w:p><w:del w:id="1"><w:r><w:delText>Bay</w:delText></w:r></w:del></w:p>`);
  const original = new Uint8Array(input);
  const module = await import("./revision-decisions.js");
  const volume = Volume.fromJSON({ "/out": "unchanged" });
  const stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  const result = await module.editDocumentRevisionDecisions(input, { operation: "revisions.reject", options: { all: true, output: "-", dryRun: true } }, { ...textContext, encoding, stdout });
  expect(result).toMatchObject({ changed: true, dryRun: true, output: null });
  const controller = new AbortController(); controller.abort();
  await expect(module.editDocumentRevisionDecisions(input, { operation: "revisions.reject", options: { all: true, output: "-" } }, { ...textContext, signal: controller.signal, encoding, stdout })).rejects.toMatchObject({ code: "cancelled" });
  await expect(module.editDocumentRevisionDecisions(input, { operation: "revisions.reject", options: { all: true, output: "-" } }, { ...textContext, encoding, stdout: { async write() { throw new Error("closed owned sink"); } } })).rejects.toMatchObject({ code: "sink-failure" });
  expect(volume.readFileSync("/out", "utf8")).toBe("unchanged");
  expect(input).toEqual(original);
});

it("checks the complete decision result envelope under a bounded output capability", async () => {
  const input = await textFixture(Array.from({ length: 15 }, (_, index) => `<w:p><w:ins w:id="${index + 1}">${run("Bay")}</w:ins></w:p>`).join(""));
  const module = await import("./revision-decisions.js");
  const request = { operation: "revisions.accept", options: { all: true, dryRun: true } } as const;
  const data = await module.editDocumentRevisionDecisions(input, request, { ...textContext, encoding });
  const length = new TextEncoder().encode(JSON.stringify({ version: 1, operation: "revisions.accept", ok: true, data, affected: data.changes.length, locations: data.changes.map(change => change.after), warnings: [], errors: [] }) + "\n").length;
  await expect(module.editDocumentRevisionDecisions(input, request, { ...textContext, encoding, budget: new DocumentBudget({ serializedOutput: length - 1 }, textContext.signal) })).rejects.toMatchObject({ code: "limit-exceeded" });
});

it.each(["ins", "del"])("preserves inherited XML language and space when lifting %s children", async kind => {
  const text = kind === "del" ? '<w:delText> Bay </w:delText>' : '<w:t> Bay </w:t>';
  const input = await textFixture(`<w:p><w:${kind} w:id="1" xml:lang="ar" xml:space="preserve"><w:r>${text}</w:r><w:r xml:lang="en" xml:space="default">${text}</w:r></w:${kind}></w:p>`);
  const { bytes } = await decide(input, kind === "ins" ? "revisions.accept" : "revisions.reject", { revision: 1 });
  const xml = new TextDecoder().decode(await getDocumentXml(bytes, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array);
  const module = await import("./package-xml.js");
  const runs = module.parseDocumentXml(new TextEncoder().encode(xml)).root.children[0]!.children[0]!.children;
  const values = runs.map(run => Object.fromEntries(run.attributes.filter(attribute => attribute.namespace === "http://www.w3.org/XML/1998/namespace").map(attribute => [attribute.localName, attribute.value])));
  expect(values).toEqual([{ lang: "ar", space: "preserve" }, { lang: "en", space: "default" }]);
});

it("retains inherited XML semantics of an old formatting snapshot", async () => {
  const input = await textFixture('<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="1" xml:lang="ar" xml:space="preserve"><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:t>Bay</w:t></w:r></w:p>');
  const { bytes } = await decide(input, "revisions.reject", { revision: 1 });
  const xml = new TextDecoder().decode(await getDocumentXml(bytes, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array);
  const module = await import("./package-xml.js");
  const properties = module.parseDocumentXml(new TextEncoder().encode(xml)).root.children[0]!.children[0]!.children[0]!.children[0]!;
  expect(Object.fromEntries(properties.attributes.filter(attribute => attribute.namespace === "http://www.w3.org/XML/1998/namespace").map(attribute => [attribute.localName, attribute.value]))).toEqual({ lang: "ar", space: "preserve" });
});

it("refuses unverified inherited XML base semantics instead of discarding them", async () => {
  const input = await textFixture(`<w:p><w:ins w:id="1" xml:base="relative/">${run("Bay")}</w:ins></w:p>`);
  await expect(decide(input, "revisions.accept", { revision: 1 })).rejects.toMatchObject({ code: "unsupported-edit" });
});
