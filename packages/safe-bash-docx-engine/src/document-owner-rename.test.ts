import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (text: string) => new TextEncoder().encode(text);
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const additional of [false, true]) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} retains the relationship collection, entries and XML when document additional=${additional} moves; strict=${strict}; kind=${kind}`, async () => {
  const fixture = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p/>');
  const seed = await api.Document(fixture.input, textContext), w = seed.element.namespace;
  const owner = additional ? await api.DocumentPartView.load("/appendix/chapter.xml", seed.part.content_type, enc(`<w:document xmlns:w="${w}"><w:body><w:p/></w:body></w:document>`), seed.part.package) : seed.part;
  const relationshipId = owner.relate_to("https://coast.example/guide#tide", fixture.relationships + "/hyperlink", true);
  if (additional) seed.part.relate_to(owner, "urn:coast:appendix");
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await seed.save({ async write(bytes) { memory.appendFileSync("/input", bytes); } });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const relname = additional ? "/appendix/_rels/chapter.xml.rels" : "/word/_rels/document.xml.rels";
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    ...(additional ? [{ operation: "model.opc.part.Part.part_related_by.call", receiver: ref("main"), arguments: { reltype: "urn:coast:appendix" }, resultHandle: "owner" }] : []),
    { operation: "model.opc.part.Part.rels.get", receiver: ref(additional ? "owner" : "main"), arguments: {}, resultHandle: "rels" },
    { operation: "model.opc.rel.Relationships.__getitem__.call", receiver: ref("rels"), arguments: { rId: relationshipId }, resultHandle: "edge" },
    { operation: "model.opc.part.Part.partname.set", receiver: ref(additional ? "owner" : "main"), arguments: { value: "/report/body.xml" } },
    { operation: "model.opc.rel._Relationship.target_ref.get", receiver: ref("edge"), arguments: {} }
  ];
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const document = await api.Document(input, textContext), selected = additional ? document.part.part_related_by("urn:coast:appendix") : document.part;
    const rels = selected.rels, edge = rels.at(relationshipId), original = rels.xml;
    selected.partname = "/report/body.xml";
    expect(selected.rels).toBe(rels); expect(rels.at(relationshipId)).toBe(edge);
    expect(edge.target_ref).toBe("https://coast.example/guide#tide"); expect(rels.xml).toBe(original);
    await document.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); expect(result.results.at(-1)!.value).toBe("https://coast.example/guide#tide"); await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe("https://coast.example/guide#tide"); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  const after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
  expect(after.get("report/_rels/body.xml.rels")).toEqual(readPackage(input).get(relname.slice(1)));
  expect(after.has(relname.slice(1))).toBe(false);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const additional of [false, true])
it(`model restores owner names and held handles after a failed rename transaction; additional=${additional}; strict=${strict}; kind=${kind}`, async () => {
  const fixture = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Primary coast</w:t></w:r></w:p><w:sectPr/>');
  const document = await api.Document(fixture.input, textContext), w = document.element.namespace;
  const owner = additional ? await api.DocumentPartView.load("/appendix/chapter.xml", document.part.content_type,
    enc(`<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Appendix coast</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`), document.part.package) : document.part;
  const story = owner.document, paragraph = story.paragraphs[0]!, element = paragraph.element, sections = story.sections, settings = story.settings;
  const originalName = owner.partname.toString(), originalText = paragraph.text;
  const memory = Volume.fromJSON({ "/before": "", "/after": "" });
  await document.save({ async write(bytes) { memory.appendFileSync("/before", bytes); } });
  const failure = new Error("coastal rollback");
  expect(() => document.store.transaction(() => { owner.partname = "/report/body.xml"; paragraph.text = "Rolled back"; throw failure; })).toThrow(failure);
  expect(owner.partname.toString()).toBe(originalName); expect(story.part).toBe(owner); expect(owner.document).toBe(story);
  expect(paragraph.text).toBe(originalText); expect(new TextDecoder().decode(element.serialize())).toContain(originalText);
  expect(sections.at(0).part).toBe(owner); expect(settings.odd_and_even_pages_header_footer).toBe(false);
  await document.save({ async write(bytes) { memory.appendFileSync("/after", bytes); } });
  expect(readPackage(new Uint8Array(memory.readFileSync("/after") as Buffer))).toEqual(readPackage(new Uint8Array(memory.readFileSync("/before") as Buffer)));
  expect(() => { owner.partname = "/Reports/%41rchive.xml"; }).toThrow();
  expect(owner.partname.toString()).toBe(originalName); expect(paragraph.text).toBe(originalText);
  owner.partname = "/Reports/Archive.xml"; owner.partname = "/final/record.xml";
  paragraph.text = "Live after repeated rename";
  expect(story.paragraphs[0]!.equals(paragraph)).toBe(true); expect(paragraph.ref.part).toBe("/final/record.xml");
  expect([...sections.at(0).iter_inner_content()].map(block => "text" in block ? block.text : "table")).toEqual(["Live after repeated rename"]);
});
