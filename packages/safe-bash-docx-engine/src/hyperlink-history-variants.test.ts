import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w, r } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const dec = (value: Uint8Array) => new TextDecoder().decode(value);
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const cases = [
  { name: "omitted", flag: null, history: true, carrier: "direct" },
  ...["0", "false", "off"].map(flag => ({ name: flag, flag, history: false, carrier: "direct" })),
  ...["1", "true", "on"].map(flag => ({ name: flag, flag, history: true, carrier: "direct" })),
  { name: "processed omission", flag: null, history: true, carrier: "process" },
  { name: "alternate omission", flag: null, history: true, carrier: "alternate" }
];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["body", "header", "footer"] as const)
for (const route of ["model", "sdk", "shell", "utility-sdk", "utility-shell"] as const)
it.each(cases)(`${route} retains $name hyperlink history and label order in ${owner}; ${kind} strict=${strict}`, async sample => {
  const namespaces = `xmlns:w="${w}" xmlns:r="${r}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:q="urn:coast:annotation" mc:Ignorable="q"`;
  const link = `<w:hyperlink r:id="coast" w:anchor="inset"${sample.flag === null ? "" : ` w:history="${sample.flag}"`}><w:r><w:t>River</w:t></w:r><w:r><w:t xml:space="preserve"> bank</w:t></w:r></w:hyperlink>`;
  const content = sample.carrier === "direct" ? link : sample.carrier === "process" ? `<q:carrier mc:ProcessContent="q:carrier">${link}</q:carrier>` : `<mc:AlternateContent><mc:Choice Requires="q"><q:payload keep="original"/></mc:Choice><mc:Fallback>${link}</mc:Fallback></mc:AlternateContent>`;
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
  for (const member of ["history", "address", "fragment", "url", "text"]) operations.push({ operation: `model.text.hyperlink.Hyperlink.${member}.get`, receiver: ref("links", 0), arguments: {} });
  operations.push({ operation: "model.text.hyperlink.Hyperlink.runs.get", receiver: ref("links", 0), arguments: {}, resultHandle: "runs" });
  for (const index of [0, 1]) operations.push({ operation: "model.text.run.Run.text.get", receiver: ref("runs", index), arguments: {} });
  operations.push({ operation: "model.text.run.Run.bold.set", receiver: ref("runs", 0), arguments: { value: true } });
  const expected = { history: sample.history, address: "https://coast.invalid/map?a=1&b=2#bank", fragment: "inset", url: "https://coast.invalid/map?a=1&b=2#bank#inset", text: "River bank" };
  let values: unknown[] | undefined;
  if (route === "model") {
    const document = await api.Document(input, context), story = owner === "body" ? document : document.sections[0]![owner], hyperlink = story.paragraphs[0]!.hyperlinks[0]!;
    expect({ history: hyperlink.history, address: hyperlink.address, fragment: hyperlink.fragment, url: hyperlink.url, text: hyperlink.text }).toEqual(expected);
    expect(hyperlink.runs.map(run => run.text)).toEqual(["River", " bank"]);
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
    expect(values.slice(-9, -4)).toEqual(Object.values(expected)); expect(values.slice(-3, -1)).toEqual(["River", " bank"]);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of parts) if (name !== part || route.startsWith("utility")) expect(saved.get(name), name).toEqual(bytes);
  if (!route.startsWith("utility")) {
    const markup = dec(saved.get(part)!); expect(markup).toContain(sample.flag === null ? 'w:anchor="inset">' : `w:history="${sample.flag}">`);
    if (sample.carrier === "alternate") expect(markup).toContain('<mc:Choice Requires="q"><q:payload keep="original"/></mc:Choice>');
    const reopened = await api.Document(output, textContext), story = owner === "body" ? reopened : reopened.sections[0]![owner]; expect(story.paragraphs[0]!.hyperlinks[0]!.runs[0]!.bold).toBe(true);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
