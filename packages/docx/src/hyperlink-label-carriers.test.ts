import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w, r } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";

const enc = (value: string) => new TextEncoder().encode(value);
const dec = (value: Uint8Array) => new TextDecoder().decode(value);
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const cases = [
  { name: "direct", flag: "1", history: true, carrier: "direct", inner: false },
  ...["process", "choice", "fallback", "nested"].flatMap(carrier => [false, true].map(inner => ({ name: carrier + (inner ? " text" : " runs"), flag: "1", history: true, carrier, inner })))
];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["body", "header", "footer"] as const)
for (const route of ["model", "sdk", "shell", "utility-sdk", "utility-shell"] as const)
it.each(cases)(`${route} reads $name hyperlink label controls and cached breaks in ${owner}; ${kind} strict=${strict}`, async sample => {
  const namespaces = `xmlns:w="${w}" xmlns:r="${r}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:q="urn:coast:annotation" mc:Ignorable="q"`;
  const wrap = (value: string) => sample.carrier === "direct" ? value : sample.carrier === "process" ? `<q:carrier mc:ProcessContent="q:carrier">${value}</q:carrier>` : `<mc:AlternateContent><mc:Choice Requires="${sample.carrier === "choice" ? "w" : "q"}">${sample.carrier === "choice" ? value : '<q:payload keep="original"><w:r><w:t>Inactive label</w:t></w:r></q:payload>'}</mc:Choice><mc:Fallback>${sample.carrier === "choice" ? '<q:payload keep="original"/>' : sample.carrier === "nested" ? `<q:carrier mc:ProcessContent="q:carrier">${value}</q:carrier>` : value}</mc:Fallback></mc:AlternateContent>`;
  const controls = '<w:ptab/><w:noBreakHyphen/><w:lastRenderedPageBreak/><w:t>bank</w:t>';
  const runs = `<w:r><w:t>River</w:t></w:r><w:r>${sample.inner ? wrap(controls) : controls}</w:r>`;
  const content = `<w:hyperlink r:id="coast" w:anchor="inset" w:history="1">${sample.inner ? runs : wrap(runs)}</w:hyperlink>`;
  const paragraph = `<w:p ${namespaces}><w:r><w:t>Map: </w:t></w:r>${content}</w:p>`;
  const section = `<w:sectPr>${owner === "body" ? "" : `<w:${owner}Reference w:type="default" r:id="story"/>`}</w:sectPr>`;
  const seed = await textFixture((owner === "body" ? paragraph : "<w:p/>") + section, owner === "body" ? {} : { story: { kind: owner, xml: `<w:${owner === "header" ? "hdr" : "ftr"} ${namespaces}>${paragraph}</w:${owner === "header" ? "hdr" : "ftr"}>` } }, strict);
  const parts = readPackage(seed), part = owner === "body" ? "word/document.xml" : "word/story.xml", relationships = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
  const relPart = owner === "body" ? "word/_rels/document.xml.rels" : "word/_rels/story.xml.rels";
  const edge = `<Relationship Id="coast" Type="${relationships}/hyperlink" Target="https://coast.invalid/map?a=1&amp;b=2#bank" TargetMode="External"/>`;
  parts.set(relPart, enc(parts.has(relPart) ? dec(parts.get(relPart)!).replace("</Relationships>", edge + "</Relationships>") : `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${edge}</Relationships>`));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(dec(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), context = { ...textContext, encoding: { order: "input", compression: "store" } as const }, sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const operations: Record<string, unknown>[] = owner === "body" ? [{ operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "ps" }] : [
    { operation: "model.document.Document.sections.get", receiver: ref("document"), arguments: {}, resultHandle: "sections" },
    { operation: `model.section.Section.${owner}.get`, receiver: ref("sections", 0), arguments: {}, resultHandle: "story" },
    { operation: `model.section._${owner === "header" ? "Header" : "Footer"}.paragraphs.get`, receiver: ref("story"), arguments: {}, resultHandle: "ps" }
  ];
  operations.push({ operation: "model.text.paragraph.Paragraph.hyperlinks.get", receiver: ref("ps", 0), arguments: {}, resultHandle: "links" });
  for (const member of ["history", "address", "fragment", "url", "text", "contains_page_break"]) operations.push({ operation: `model.text.hyperlink.Hyperlink.${member}.get`, receiver: ref("links", 0), arguments: {} });
  operations.push({ operation: "model.text.hyperlink.Hyperlink.runs.get", receiver: ref("links", 0), arguments: {}, resultHandle: "runs" });
  for (const index of [0, 1]) operations.push({ operation: "model.text.run.Run.text.get", receiver: ref("runs", index), arguments: {} });
  operations.push({ operation: "model.text.run.Run.bold.set", receiver: ref("runs", 0), arguments: { value: true } });
  const expected = { history: sample.history, address: "https://coast.invalid/map?a=1&b=2#bank", fragment: "inset", url: "https://coast.invalid/map?a=1&b=2#bank#inset", text: "River\t-bank", contains_page_break: true };
  let values: unknown[] | undefined;
  if (route === "model") {
    const document = await api.Document(input, context), story = owner === "body" ? document : document.sections[0]![owner], hyperlink = story.paragraphs[0]!.hyperlinks[0]!;
    expect({ history: hyperlink.history, address: hyperlink.address, fragment: hyperlink.fragment, url: hyperlink.url, text: hyperlink.text, contains_page_break: hyperlink.contains_page_break }).toEqual(expected);
    expect(hyperlink.runs.map(run => run.text)).toEqual(["River", "\t-bank"]);
    expect(hyperlink.part.blob).toEqual(parts.get(part)); hyperlink.runs[0]!.bold = true; await document.save(sink);
  } else if (route === "utility-sdk") {
    const result = await api.inspectDocumentLinks(input, { scope: owner === "body" ? "body" : owner === "header" ? "headers" : "footers" }, context);
    expect(result.items).toHaveLength(1); expect(result.items[0]).toMatchObject(expected); memory.writeFileSync("/output", input);
  } else if (route === "sdk") {
    const result = await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: sink }); values = result.results.map(item => item.data);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const result = await shell.exec(route === "shell" ? "docx batch /input --ops-file /ops --output /output --json" : `docx links list /input --scope ${owner === "body" ? "body" : owner === "header" ? "headers" : "footers"} --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); const envelope = JSON.parse(result.stdout); expect(envelope.errors).toEqual([]);
      if (route === "shell") values = envelope.data.results.map((item: { data: unknown }) => item.data);
      else { expect(envelope.affected).toBe(0); expect(envelope.data.items).toHaveLength(1); expect(envelope.data.items[0]).toMatchObject(expected); }
      memory.writeFileSync("/output", route === "shell" ? await fs.readFile("/output") : input); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (values) {
    expect(values.slice(-10, -4)).toEqual(Object.values(expected)); expect(values.slice(-3, -1)).toEqual(["River", "\t-bank"]);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of parts) if (name !== part || route.startsWith("utility")) expect(saved.get(name), name).toEqual(bytes);
  if (!route.startsWith("utility")) {
    const markup = dec(saved.get(part)!); expect(markup).toContain(sample.flag === null ? 'w:anchor="inset">' : `w:history="${sample.flag}">`);
    if (["choice", "fallback", "nested"].includes(sample.carrier)) expect(markup).toContain('keep="original"');
    const reopened = await api.Document(output, textContext), story = owner === "body" ? reopened : reopened.sections[0]![owner]; expect(story.paragraphs[0]!.hyperlinks[0]!.runs[0]!.bold).toBe(true);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const flag of ["invalid", "TRUE", "2", ""])
for (const route of ["model", "sdk", "shell", "utility-sdk", "utility-shell"] as const)
it(`${route} rejects invalid stored hyperlink flag ${JSON.stringify(flag)}; ${kind} strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p><w:hyperlink w:anchor="coast" w:history="${flag}"><w:r><w:t>Coast</w:t></w:r></w:hyperlink></w:p>`);
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "ps" },
    { operation: "model.text.paragraph.Paragraph.hyperlinks.get", receiver: ref("ps", 0), arguments: {}, resultHandle: "links" },
    { operation: "model.text.hyperlink.Hyperlink.history.get", receiver: ref("links", 0), arguments: {} }
  ];
  if (route === "model") { const document = await api.Document(input, textContext); expect(() => document.paragraphs[0]!.hyperlinks[0]!.history).toThrow(api.InvalidValueError); }
  else if (route === "sdk") await expect(api.executeDocumentBatch(input, { version: 1, operations }, {}, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "usage" });
  else if (route === "utility-sdk") await expect(api.inspectDocumentLinks(input, {}, textContext)).rejects.toMatchObject({ code: "usage" });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(route === "shell" ? "docx batch /input --ops-file /ops --json" : "docx links list /input --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(2); expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "usage" }] }); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
});
