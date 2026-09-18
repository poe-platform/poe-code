import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value), ref = (resultHandle: string) => ({ resultHandle });
const pr = "http://schemas.openxmlformats.org/package/2006/relationships", mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const stamp = new Date("2026-01-02T03:04:06Z");
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const factory of ["core", "numbering"] as const) for (const existing of [false, true])
for (const carrier of ["direct", "choice", "fallback", "process", "nested"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} creates or reuses native ${factory} via ${carrier}; existing=${existing} ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const role = factory === "core" ? "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" : r + "/numbering", contentType = factory === "core" ? "application/vnd.openxmlformats-package.core-properties+xml" : "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml", nativeName = "records/retained.xml";
  const selected = factory === "core" ? "_rels/.rels" : "word/_rels/document.xml.rels", target = factory === "core" ? nativeName : "../" + nativeName;
  const main = `<pr:Relationship Id="main" Type="${r}/officeDocument" Target="word/document.xml"/>`, inert = '<pr:Relationship Id="audit" Type="urn:ledger:inert" Target="file:///private/retained" TargetMode="External"/>', edge = existing ? `<pr:Relationship Id="native" Type="${role}" Target="${target}"/>` : "";
  const inactive = '<f:opaque id="archived"><!--unselected relationship content--></f:opaque>', process = (body: string) => `<f:carrier>${body}</f:carrier>`, choice = (body: string, fallback = false) => `<mc:AlternateContent><mc:Choice Requires="${fallback ? "f" : "pr"}">${fallback ? inactive : body}</mc:Choice><mc:Fallback>${fallback ? body : inactive}</mc:Fallback></mc:AlternateContent>`;
  const active = inert + edge, wrapped = carrier === "direct" ? active : carrier === "choice" ? choice(active) : carrier === "fallback" ? choice(active, true) : carrier === "process" ? process(active) : choice(process(active));
  const envelope = (body: string) => `<?xml version="1.0"?><!--prolog retained--><pr:Relationships xmlns:pr="${pr}" xmlns:mc="${mc}" xmlns:f="urn:ledger:future" mc:Ignorable="f" mc:ProcessContent="f:carrier"><!--before edges-->${body}<?audit retained?></pr:Relationships>`;
  const parts = new Map<string, Uint8Array>([
    ["[Content_Types].xml", enc(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml"/>${existing ? `<Override PartName="/${nativeName}" ContentType="${contentType}"/>` : ""}</Types>`)],
    ["word/document.xml", enc(`<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Factory ledger</w:t></w:r></w:p></w:body></w:document>`)],
    ["_rels/.rels", enc(envelope(main + (factory === "core" ? wrapped : "")))],
    ["word/_rels/document.xml.rels", enc(envelope(factory === "numbering" ? wrapped : ""))]
  ]);
  if (existing) parts.set(nativeName, enc(factory === "core" ? '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><!--retained metadata--><dc:title>Stored ledger</dc:title><cp:revision>7</cp:revision></cp:coreProperties>' : `<w:numbering xmlns:w="${w}"><!--retained numbering--><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1"/></w:lvl></w:abstractNum><w:num w:numId="4"><w:abstractNumId w:val="0"/></w:num></w:numbering>`));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: stamp })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), context = { ...textContext, timestamp: stamp, author: "Ledger author", encoding: { order: "input", compression: "store" } as const }, sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const prefix = factory === "core" ? "model.opc.parts.coreprops.CorePropertiesPart" : "model.parts.numbering.NumberingPart", method = factory === "core" ? "default" : "new";
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" },
    ...["first", "second"].map(resultHandle => ({ operation: `${prefix}.${method}.call`, arguments: { ownerPackage: ref("package") }, resultHandle })),
    { operation: `${prefix}.partname.get`, receiver: ref("first"), arguments: {} },
    { operation: `${prefix}.partname.get`, receiver: ref("second"), arguments: {} },
    { operation: `${prefix}.${factory === "core" ? "core_properties" : "numbering_definitions"}.get`, receiver: ref("first"), arguments: {}, resultHandle: "view" },
    { operation: factory === "core" ? "model.opc.coreprops.CoreProperties.title.get" : "model.NumberingDefinitionsView.length.get", receiver: ref("view"), arguments: {} }
  ];
  const expected = factory === "core" ? existing ? "Stored ledger" : "Document" : existing ? 1 : 0;
  if (route === "model") {
    const doc = await api.Document(input, context), part = factory === "core" ? api.CorePropertiesPartView.default(doc.part.package) : api.NumberingPart.new(doc.part.package), again = factory === "core" ? api.CorePropertiesPartView.default(doc.part.package) : api.NumberingPart.new(doc.part.package);
    expect(again).toBe(part); expect(part.package).toBe(doc.part.package); expect(part.content_type).toBe(contentType);
    expect(part instanceof api.CorePropertiesPartView ? part.core_properties.title : part.numbering_definitions.length).toBe(expected);
    await doc.save(sink);
  } else if (route === "sdk") {
    const result = await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-", timestamp: stamp.toISOString(), author: "Ledger author" }, { ...context, stdout: sink });
    expect(result.results[4]!.data).toBe(result.results[5]!.data); expect(result.results[7]!.data).toBe(expected);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec("docx batch /input --ops-file /ops --timestamp 2026-01-02T03:04:06Z --author 'Ledger author' --output /output --json"), envelope = JSON.parse(response.stdout);
      expect(response.exitCode, response.stdout + response.stderr).toBe(0); expect(envelope.data.results[4].data).toBe(envelope.data.results[5].data); expect(envelope.data.results[7].data).toBe(expected);
      memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const saved = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
  for (const [name, bytes] of parts) if (existing || !["[Content_Types].xml", selected].includes(name)) expect(saved.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(saved.get(selected)!); for (const token of [inert, "<!--prolog retained-->", "<!--before edges-->", "<?audit retained?>"]) expect(xml).toContain(token); if (["choice", "fallback", "nested"].includes(carrier)) expect(xml).toContain(inactive);
  const reopened = await api.Document(new Uint8Array(memory.readFileSync("/output") as Buffer), context), rels = factory === "core" ? reopened.part.package.rels : reopened.part.rels;
  const matches = [...rels.values()].filter(edge => edge.reltype === role); expect(matches).toHaveLength(1); expect(matches[0]!.target_part.content_type).toBe(contentType);
  const native = xmlStructure(matches[0]!.target_part.blob); expect(native).toBeDefined(); expect(reopened.paragraphs[0]!.text).toBe("Factory ledger"); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
