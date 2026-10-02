import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";
import { rasterPng } from "../tests/fixtures/raster.js";

const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const enc = (value: string) => new TextEncoder().encode(value);
type NativeDocument = api.DocumentPartView & {
  add_header_part(): readonly [api.HeaderPart, string]; add_footer_part(): readonly [api.FooterPart, string];
  header_part(id: string): api.HeaderPart; footer_part(id: string): api.FooterPart; drop_header_part(id: string): void;
};

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const shared of [false, true]) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} removes only the unshared header and its outgoing relationships; strict=${strict}; kind=${kind}; shared=${shared}`, async () => {
  const fixture = await nativeStoryFixture("hdrftr.HeaderPart", strict, kind, "<w:p/>");
  const doc = await api.Document(fixture.input, textContext), header = doc.part.header_part("native"), raster = rasterPng(2, 3);
  await header.get_or_add_image(raster);
  if (shared) doc.part.relate_to(header, "urn:original:retained-header");
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await doc.save({ async write(bytes) { memory.appendFileSync("/input", bytes); } });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = readPackage(input);
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.drop_header_part.call", receiver: ref("main"), arguments: { rId: "native" } }
  ];
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const reopened = await api.Document(input, textContext), part = reopened.part.header_part("native"), edge = part.rels.values().next().value!;
    reopened.part.drop_header_part("native");
    if (shared) { expect(part.blob).toEqual(before.get("word/native.xml")); expect(edge.target_part.blob).toEqual(raster); }
    else { expect(() => part.blob).toThrow(api.StaleHandleError); expect(() => edge.target_part).toThrow(api.StaleHandleError); }
    await reopened.save(sink);
  } else if (route === "sdk") await (await api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).save(sink);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
  for (const name of ["word/native.xml", "word/_rels/native.xml.rels"]) expect(after.has(name), name).toBe(shared);
  for (const [name, bytes] of before) if (!["[Content_Types].xml", "word/_rels/document.xml.rels", ...(!shared ? ["word/native.xml", "word/_rels/native.xml.rels"] : [])].includes(name)) expect(after.get(name), name).toEqual(bytes);
  expect(after.get("word/media/image1.png")).toEqual(raster);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const role of ["header", "footer"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} creates and looks up distinct native ${role} parts; strict=${strict}; kind=${kind}`, async () => {
  const { input, relationships } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Coastal register</w:t></w:r></w:p>');
  const memory = Volume.fromJSON({ "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const before = readPackage(input), owner = role === "header" ? "HeaderPart" : "FooterPart";
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: `model.parts.document.DocumentPart.add_${role}_part.call`, receiver: ref("main"), arguments: {}, resultHandle: "first" },
    { operation: `model.parts.document.DocumentPart.add_${role}_part.call`, receiver: ref("main"), arguments: {}, resultHandle: "second" },
    { operation: `model.parts.hdrftr.${owner}.blob.get`, receiver: ref("first", 0), arguments: {} },
    { operation: `model.parts.document.DocumentPart.${role}_part.call`, receiver: ref("main"), arguments: { rId: ref("second", 1) }, resultHandle: "lookup" },
    { operation: `model.parts.hdrftr.${owner}.partname.get`, receiver: ref("lookup"), arguments: {} }
  ];
  if (route === "model") {
    const doc = await api.Document(input, textContext), part = doc.part as NativeDocument;
    expect(part[`add_${role}_part`]).toBeTypeOf("function");
    const first = part[`add_${role}_part`](), second = part[`add_${role}_part`]();
    expect(first).not.toBeInstanceOf(Promise); expect(first[0]).toBeInstanceOf(api[owner]);
    expect(first[1]).not.toBe(second[1]); expect(String(first[0].partname)).toBe(`/word/${role}1.xml`);
    expect(String(second[0].partname)).toBe(`/word/${role}2.xml`);
    expect(part[`${role}_part`](second[1])).toBe(second[0]);
    expect(part.rels.at(first[1]).reltype).toBe(`${relationships}/${role}`); await doc.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    expect(result.results.at(-1)!.value).toBe(`/word/${role}2.xml`); await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe(`/word/${role}2.xml`);
      memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  for (const [name, bytes] of before) if (name !== "[Content_Types].xml" && name !== "word/_rels/document.xml.rels") expect(after.get(name), name).toEqual(bytes);
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  for (const ordinal of [1, 2]) {
    const tree = xmlStructure(after.get(`word/${role}${ordinal}.xml`)!);
    const root = tree.children.find(child => typeof child !== "string");
    expect(root?.name).toBe(`{${word}}${role === "header" ? "hdr" : "ftr"}`);
    expect(root?.children).toHaveLength(1); expect(root?.children[0]).toMatchObject({ name: `{${word}}p` });
  }
  expect((await api.Document(output, textContext)).paragraphs[0]!.text).toBe("Coastal register");
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} drops an unreferenced native header without touching the body; strict=${strict}; kind=${kind}`, async () => {
  const fixture = await nativeStoryFixture("hdrftr.HeaderPart", strict, kind, '<w:p><w:r><w:t>Retained coast</w:t></w:r></w:p>');
  const before = readPackage(fixture.input), memory = Volume.fromJSON({ "/output": "" });
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.drop_header_part.call", receiver: ref("main"), arguments: { rId: "native" } }
  ];
  if (route === "model") {
    const doc = await api.Document(fixture.input, textContext), part = doc.part as NativeDocument;
    expect(part.drop_header_part).toBeTypeOf("function"); part.drop_header_part("native"); expect(part.rels.has("native")).toBe(false); await doc.save(sink);
  } else if (route === "sdk") await (await api.applyStyleModelBatch(fixture.input, { version: 1, operations }, textContext)).save(sink);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", fixture.input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(fixture.input);
    } finally { await shell.dispose(); }
  }
  const after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
  expect(after.has("word/native.xml")).toBe(false);
  for (const [name, bytes] of before) if (!["[Content_Types].xml", "word/_rels/document.xml.rels", "word/native.xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
it(`invalidates removed native header and relationship handles before reusing their names; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, "<w:p/>");
  const doc = await api.Document(input, textContext), part = doc.part as NativeDocument;
  expect(part.add_header_part).toBeTypeOf("function");
  const [old, id] = part.add_header_part(), edge = part.rels.at(id), name = old.partname.toString();
  part.drop_header_part(id);
  expect(() => old.blob).toThrow(); expect(() => edge.rId).toThrow();
  const [current, reused] = part.add_header_part();
  expect(current.partname.toString()).toBe(name); expect(reused).toBe(id); expect(current).not.toBe(old);
  expect(() => old.blob).toThrow(); expect(() => edge.rId).toThrow();
  expect(part.header_part(reused)).toBe(current);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const scenario of ["active-reference", "inactive-reference", "shared-edge", "inactive-edge", "other-owner-edge", "other-owner-inactive"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`retains native header ownership under ${scenario}; strict=${strict}; kind=${kind}${route === "model" ? "" : `; ${route}`}`, async () => {
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const reference = `<w:sectPr><w:headerReference w:type="default" r:id="native"/></w:sectPr>`;
  const branch = (content: string) => `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:future"><mc:Choice Requires="f">${content}</mc:Choice><mc:Fallback/></mc:AlternateContent>`;
  const fixture = await nativeStoryFixture("hdrftr.HeaderPart", strict, kind, "<w:p/>");
  const original = readPackage(fixture.input);
  if (scenario.endsWith("reference")) original.set("word/document.xml", enc(`<w:document xmlns:w="${w}" xmlns:r="${r}"><w:body><w:p/>${scenario === "active-reference" ? reference : branch(reference)}</w:body></w:document>`));
  else {
    const rels = new TextDecoder().decode(original.get("word/_rels/document.xml.rels")!);
    const alias = `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="alias" Type="urn:original:retain" Target="native.xml"/>`;
    if (scenario.startsWith("other-owner")) {
      original.set("[Content_Types].xml", enc(new TextDecoder().decode(original.get("[Content_Types].xml")!).replace("</Types>", '<Override PartName="/data/ledger.xml" ContentType="application/xml"/></Types>')));
      original.set("data/ledger.xml", enc("<ledger/>"));
      const otherAlias = alias.replace('Target="native.xml"', 'Target="../word/native.xml"');
      original.set("data/_rels/ledger.xml.rels", enc(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${scenario === "other-owner-edge" ? otherAlias : branch(otherAlias)}</Relationships>`));
    } else original.set("word/_rels/document.xml.rels", enc(rels.replace("</Relationships>", (scenario === "shared-edge" ? alias : branch(alias)) + "</Relationships>")));
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...original].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { compression: "store", order: "input" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), rejected = scenario.endsWith("reference");
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.drop_header_part.call", receiver: ref("main"), arguments: { rId: "native" } }
  ];
  if (route === "model") {
    const doc = await api.Document(input, textContext), part = doc.part as NativeDocument;
    expect(part.drop_header_part).toBeTypeOf("function");
    if (rejected) expect(() => part.drop_header_part("native")).toThrow(api.UnsupportedEditError);
    else { part.drop_header_part("native"); expect(part.rels.has("native")).toBe(false); }
    await doc.save(sink);
  } else if (route === "sdk") {
    const pending = api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    if (rejected) { await expect(pending).rejects.toBeInstanceOf(api.UnsupportedEditError); memory.writeFileSync("/output", input); }
    else await (await pending).save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", enc("sentinel")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(rejected ? 1 : 0);
      if (rejected) { expect(JSON.parse(result.stdout).errors[0].code).toBe("unsupported-edit"); expect(await fs.readFile("/output")).toEqual(enc("sentinel")); memory.writeFileSync("/output", input); }
      else memory.writeFileSync("/output", await fs.readFile("/output"));
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
  for (const [name, bytes] of original) if (scenario.endsWith("reference") || name !== "word/_rels/document.xml.rels") expect(after.get(name), name).toEqual(bytes);
  if (scenario === "inactive-edge") expect(new TextDecoder().decode(after.get("word/_rels/document.xml.rels")!)).toContain(branch(`<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="alias" Type="urn:original:retain" Target="native.xml"/>`));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const role of ["header", "footer"] as const) for (const method of ["document", "factory"] as const)
it(`rolls back native ${role} name reservations after ${method} creation exceeds inserted-node budget; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, "<w:p/>");
  const doc = await api.Document(input, { ...textContext, budget: new api.DocumentBudget({ insertedNodes: 0 }) });
  const package_ = doc.part.package, before = package_.parts.map(part => [String(part.partname), part.blob]);
  expect(() => method === "document" ? (doc.part as NativeDocument)[`add_${role}_part`]() : (role === "header" ? api.HeaderPart : api.FooterPart).new(package_)).toThrow(api.ResourceLimitError);
  expect(package_.parts.map(part => [String(part.partname), part.blob])).toEqual(before);
  expect(package_.next_partname(`/word/${role}%d.xml`).toString()).toBe(`/word/${role}1.xml`);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const method of ["header_part", "footer_part", "drop_header_part"] as const)
for (const scenario of ["missing", "wrong-role", "input-type"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`rejects ${scenario} ${method} without changing package ownership; strict=${strict}; kind=${kind}${route === "model" ? "" : `; ${route}`}`, async () => {
  const fixture = await nativeStoryFixture(method === "footer_part" ? "hdrftr.HeaderPart" : "hdrftr.FooterPart", strict, kind, "<w:p/>");
  const id = scenario === "missing" ? "absent" : scenario === "input-type" ? 17 as never : "native";
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: `model.parts.document.DocumentPart.${method}.call`, receiver: ref("main"), arguments: { rId: id } }
  ];
  if (route === "model") {
    const doc = await api.Document(fixture.input, textContext), part = doc.part as NativeDocument;
    const before = part.package.parts.map(part => [String(part.partname), part.blob]);
    expect(() => part[method](id)).toThrow(scenario === "missing" ? api.MissingKeyError : scenario === "input-type" ? api.InputTypeError : api.InvalidValueError);
    expect(part.package.parts.map(part => [String(part.partname), part.blob])).toEqual(before);
  } else if (route === "sdk") {
    await expect(api.applyStyleModelBatch(fixture.input, { version: 1, operations }, textContext)).rejects.toMatchObject({ code: scenario === "missing" ? "missing-selection" : "usage" });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", fixture.input); await fs.writeFile("/sentinel", enc("keep")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-file /ops --json${method === "drop_header_part" ? " --output /sentinel --force" : ""}`);
      expect(result.exitCode).toBe(scenario === "missing" ? 1 : 2); expect(JSON.parse(result.stdout).errors[0].code).toBe(scenario === "missing" ? "missing-selection" : "usage");
      expect(await fs.readFile("/sentinel")).toEqual(enc("keep")); expect(await fs.readFile("/input")).toEqual(fixture.input);
    } finally { await shell.dispose(); }
  }
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const role of ["header", "footer"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} binds a native ${role} to the actual loaded document owner; strict=${strict}; kind=${kind}`, async () => {
  const fixture = await nativeStoryFixture("document.DocumentPart", strict, kind, "<w:p/>");
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const xml = enc(`<w:document xmlns:w="${word}"><w:body><w:p><w:r><w:t>Appendix tide</w:t></w:r></w:p></w:body></w:document>`);
  const type = `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml`;
  const memory = Volume.fromJSON({ "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" },
    { operation: "model.parts.document.DocumentPart.load.call", arguments: { ownerPackage: ref("package"), partname: "/appendix/chapter.xml", contentType: type, blob: { kind: "bytes", base64: Buffer.from(xml).toString("base64") } }, resultHandle: "chapter" },
    { operation: `model.parts.document.DocumentPart.add_${role}_part.call`, receiver: ref("chapter"), arguments: {}, resultHandle: "created" },
    { operation: "model.parts.document.DocumentPart.target_ref.call", receiver: ref("chapter"), arguments: { rId: ref("created", 1) } }
  ];
  if (route === "model") {
    const doc = await api.Document(fixture.input, textContext);
    const owner = await api.DocumentPartView.load("/appendix/chapter.xml", type, xml, doc.part.package);
    const [story, id] = owner[`add_${role}_part`]();
    expect(story.partname.toString()).toBe(`/appendix/${role}1.xml`); expect(owner.target_ref(id)).toBe(`${role}1.xml`);
    expect(doc.part.rels.has(id)).toBe(false); await doc.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(fixture.input, { version: 1, operations }, textContext);
    expect(result.results.at(-1)!.value).toBe(`${role}1.xml`); await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", fixture.input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe(`${role}1.xml`); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(fixture.input);
    } finally { await shell.dispose(); }
  }
  const after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
  expect(after.get("appendix/chapter.xml")).toEqual(xml); expect(after.has(`appendix/${role}1.xml`)).toBe(true); expect(after.has("appendix/_rels/chapter.xml.rels")).toBe(true);
  for (const [name, bytes] of readPackage(fixture.input)) if (name !== "[Content_Types].xml") expect(after.get(name), name).toEqual(bytes);
});
