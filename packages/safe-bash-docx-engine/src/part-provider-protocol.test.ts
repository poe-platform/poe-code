import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const enc = (text: string) => new TextEncoder().encode(text);

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const protocol of ["ProvidesStoryPart", "ProvidesXmlPart"] as const)
for (const owner of ["document", "paragraph", "run", "part"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} resolves ${protocol} from its admitted ${owner}; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Owner tide</w:t></w:r></w:p>');
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" },
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: `model.types.${protocol}.part.get`, receiver: owner === "document" ? ref("document") : owner === "part" ? ref("main") : ref(owner === "run" ? "runs" : "paragraphs", 0), arguments: {}, resultHandle: "provided" },
    { operation: "model.opc.part.XmlPart.blob.get", receiver: ref("provided"), arguments: {} }
  ];
  let bytes: Uint8Array;
  if (route === "model") {
    const doc = await api.Document(input, textContext), selected = owner === "document" ? doc : owner === "part" ? doc.part : owner === "run" ? doc.paragraphs[0]!.runs[0]! : doc.paragraphs[0]!;
    expect(selected.part).toBe(doc.part); expect(selected.part).toBeInstanceOf(api[protocol === "ProvidesStoryPart" ? "StoryPart" : "XmlPartView"]); bytes = selected.part.blob;
    const volume = Volume.fromJSON({ "/output": "" }); await doc.save({ async write(chunk) { volume.appendFileSync("/output", chunk); } });
    expect(readPackage(new Uint8Array(volume.readFileSync("/output") as Buffer))).toEqual(readPackage(input));
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    bytes = new Uint8Array(Buffer.from((result.results.at(-1)!.value as { base64: string }).base64, "base64")); expect(result.affected).toBe(0);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const data = JSON.parse(result.stdout); bytes = new Uint8Array(Buffer.from(data.data.results.at(-1).data.base64, "base64")); expect(data.affected).toBe(0); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  expect(bytes).toEqual(readPackage(input).get("word/document.xml"));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const protocol of ["ProvidesStoryPart", "ProvidesXmlPart"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} rejects a detached native provider after name reuse; protocol=${protocol}; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p/><w:sectPr/>');
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.add_header_part.call", receiver: ref("main"), arguments: {}, resultHandle: "old" },
    { operation: "model.parts.document.DocumentPart.drop_header_part.call", receiver: ref("main"), arguments: { rId: ref("old", 1) } },
    { operation: "model.parts.document.DocumentPart.add_header_part.call", receiver: ref("main"), arguments: {}, resultHandle: "new" },
    { operation: `model.types.${protocol}.part.get`, receiver: ref("old", 0), arguments: {} }
  ];
  if (route === "model") {
    const doc = await api.Document(input, textContext), [part, id] = doc.part.add_header_part(), name = String(part.partname);
    doc.part.drop_header_part(id); expect(String(doc.part.add_header_part()[0].partname)).toBe(name);
    expect(() => part.part).toThrow(api.StaleHandleError);
  } else if (route === "sdk") {
    await expect(api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).rejects.toMatchObject({ code: "stale-selection", operationIndex: 4 });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", enc("retained")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json");
      expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "stale-selection", operationIndex: 4 }] });
      expect(await fs.readFile("/output")).toEqual(enc("retained")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const protocol of ["ProvidesStoryPart", "ProvidesXmlPart", "direct"] as const)
for (const variant of ["header", "first_page_header", "even_page_header", "footer", "first_page_footer", "even_page_footer"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} retains creating ${variant} provider semantics; protocol=${protocol}; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p/><w:sectPr/>');
  const role = variant.endsWith("header") ? "header" : "footer";
  const operations = [
    { operation: "model.document.Document.sections.get", receiver: ref("document"), arguments: {}, resultHandle: "sections" },
    { operation: `model.section.Section.${variant}.get`, receiver: ref("sections", 0), arguments: {}, resultHandle: "story" },
    { operation: protocol === "direct" ? `model.section._${role === "header" ? "Header" : "Footer"}.part.get` : `model.types.${protocol}.part.get`, receiver: ref("story"), arguments: {}, resultHandle: "provided" },
    { operation: "model.opc.part.Part.partname.get", receiver: ref("provided"), arguments: {} }
  ];
  let output: Uint8Array;
  if (route === "model") {
    const doc = await api.Document(input, textContext), part = doc.sections[0]![variant].part;
    expect(part).toBeInstanceOf(api.StoryPart); expect(doc.sections[0]![variant].part).toBe(part);
    const volume = Volume.fromJSON({ "/output": "" }); await doc.save({ async write(chunk) { volume.appendFileSync("/output", chunk); } }); output = new Uint8Array(volume.readFileSync("/output") as Buffer);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); expect(result.affected).toBe(1); expect(result.operationResults[2]!.affected).toBe(1);
    const volume = Volume.fromJSON({ "/output": "" }); await result.save({ async write(chunk) { volume.appendFileSync("/output", chunk); } }); output = new Uint8Array(volume.readFileSync("/output") as Buffer);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const missing = await shell.exec("docx batch /input --ops-file /ops --json"); expect(missing.exitCode).toBe(2); expect(JSON.parse(missing.stdout).errors[0].code).toBe("usage");
      const dry = await shell.exec("docx batch /input --ops-file /ops --dry-run --json"); expect(dry.exitCode, dry.stdout + dry.stderr).toBe(0); expect(JSON.parse(dry.stdout).affected).toBe(1);
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).affected).toBe(1);
      output = await fs.readFile("/output"); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const parts = readPackage(output), story = [...parts].find(([name]) => name.includes(role) && name.endsWith(".xml"))!;
  expect(story).toBeDefined(); expect(new TextDecoder().decode(story[1])).toContain("<w:p");
  const doc = await api.Document(output, textContext); expect(doc.sections[0]![variant].is_linked_to_previous).toBe(false);
  const before = readPackage(input);
  for (const [name, bytes] of before) if (!["word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"].includes(name)) expect(parts.get(name), name).toEqual(bytes);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["styles", "settings", "core"] as const)
for (const protocol of ["ProvidesStoryPart", "ProvidesXmlPart"] as const)
for (const route of ["sdk", "shell"] as const)
it(`${route} admits XML and rejects story access for ${owner}; protocol=${protocol}; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p/>');
  const doc = await api.Document(input, { ...textContext, timestamp: new Date("2026-01-02T03:04:06Z") });
  // Materialize resources before testing read purity of the public batch.
  void doc.styles; void doc.settings; void doc.core_properties;
  const volume = Volume.fromJSON({ "/fixture": "" }); await doc.save({ async write(chunk) { volume.appendFileSync("/fixture", chunk); } });
  const source = new Uint8Array(volume.readFileSync("/fixture") as Buffer);
  const operations = [
    { operation: `model.document.Document.${owner === "core" ? "core_properties" : owner}.get`, receiver: ref("document"), arguments: {}, resultHandle: "owner" },
    { operation: `model.types.${protocol}.part.get`, receiver: ref("owner"), arguments: {}, resultHandle: "part" },
    { operation: "model.opc.part.Part.content_type.get", receiver: ref("part"), arguments: {} }
  ];
  if (route === "sdk") {
    if (protocol === "ProvidesStoryPart") await expect(api.applyStyleModelBatch(source, { version: 1, operations }, textContext)).rejects.toMatchObject({ code: "usage" });
    else { const result = await api.applyStyleModelBatch(source, { version: 1, operations }, textContext); expect(result.affected).toBe(0); expect(result.results[2]!.value).toContain(owner === "core" ? "core-properties" : owner); }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", source); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --dry-run --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(protocol === "ProvidesStoryPart" ? 2 : 0);
      if (protocol === "ProvidesStoryPart") expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, affected: 0, data: null, errors: [{ code: "usage" }] });
      else expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, affected: 0 });
      expect(await fs.readFile("/input")).toEqual(source);
    } finally { await shell.dispose(); }
  }
});

it("exposes native owner types through the public provider interfaces", async () => {
  const doc = await api.Document(undefined, { ...textContext, timestamp: new Date("2026-01-02T03:04:06Z") });
  const paragraph = doc.add_paragraph("Typed coast"), run = paragraph.runs[0]!, table = doc.add_table(1, 1, api.Inches(1));
  const providers: readonly api.ProvidesStoryPart[] = [doc, paragraph, run, table, table.cell(0, 0), doc.sections[0]!, doc.sections[0]!.header, doc.part, doc.comments.add_comment("Typed note")];
  for (const provider of providers) expect(provider.part).toBeInstanceOf(api.StoryPart);
  const xml: readonly api.ProvidesXmlPart[] = providers;
  expect(xml).toHaveLength(9);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["HeaderPart", "FooterPart", "CommentsPart"] as const)
for (const protocol of ["ProvidesStoryPart", "ProvidesXmlPart"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} returns the actual native ${owner} through ${protocol}; strict=${strict}; kind=${kind}`, async () => {
  const { input, role, relationships } = await nativeStoryFixture(owner, strict, kind, '<w:p><w:r><w:t>Remote shore</w:t></w:r></w:p>');
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.opc.part.Part.part_related_by.call", receiver: ref("main"), arguments: { reltype: `${relationships}/${role}` }, resultHandle: "native" },
    { operation: `model.types.${protocol}.part.get`, receiver: ref("native"), arguments: {}, resultHandle: "provided" },
    { operation: "model.opc.part.Part.partname.get", receiver: ref("provided"), arguments: {} },
    { operation: "model.opc.part.Part.blob.get", receiver: ref("provided"), arguments: {} }
  ];
  const expected = readPackage(input).get("word/native.xml");
  if (route === "model") {
    const doc = await api.Document(input, textContext), part = doc.part.part_related_by(`${relationships}/${role}`) as api.StoryPart;
    expect(part).toBeInstanceOf(api[owner]); expect(part.part).toBe(part); expect(part.part.blob).toEqual(expected);
    const volume = Volume.fromJSON({ "/output": "" }); await doc.save({ async write(chunk) { volume.appendFileSync("/output", chunk); } }); expect(readPackage(new Uint8Array(volume.readFileSync("/output") as Buffer))).toEqual(readPackage(input));
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); expect(result.affected).toBe(0); expect(result.results[3]!.value).toBe("/word/native.xml");
    expect(new Uint8Array(Buffer.from((result.results[4]!.value as { base64: string }).base64, "base64"))).toEqual(expected);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const envelope = JSON.parse(result.stdout); expect(envelope.affected).toBe(0); expect(envelope.data.results[3].data).toBe("/word/native.xml");
      expect(new Uint8Array(Buffer.from(envelope.data.results[4].data.base64, "base64"))).toEqual(expected); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
});
