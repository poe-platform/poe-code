import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { colonPartFixture } from "../tests/fixtures/colon-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const compression of ["store", "deflate"] as const)
for (const main of ["reports/a:b.xml", "report:2026/body.xml", "reports/a%3Ab.xml", "reports/body.xml"])
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} reads and edits OPC part ${main}; ${kind} strict=${strict} ${compression}`, async () => {
  const fixture = colonPartFixture(strict, kind, compression, main), { input, parts } = fixture;
  expect(readPackage(input)).toEqual(parts);
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const doc = await api.Document(input, textContext);
    expect(String(doc.part.partname)).toBe("/" + main); expect(doc.part.content_type).toBe(fixture.type);
    expect(doc.part.blob).toEqual(parts.get(main)); expect(doc.paragraphs[0]!.text).toBe("Original estuary");
    doc.paragraphs[0]!.runs[0]!.text = "Updated estuary"; await doc.save(sink);
  } else if (route === "sdk") {
    const inspection = await api.inspectDocument(input, textContext); expect(inspection.kind).toBe(kind); expect(inspection.dialect).toBe(strict ? "strict" : "transitional");
    expect(await api.getDocumentXml(input, textContext, { part: "/" + main, raw: true })).toEqual(parts.get(main));
    const result = await api.replaceDocumentText(input, { find: "Original estuary", with: "Updated estuary", first: true, output: "-" }, { ...textContext, encoding: { compression, order: "input" }, stdout: sink }); expect(result.changed).toBe(true);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const inspection = await shell.exec("docx inspect /input --json"); expect(inspection.exitCode, inspection.stdout + inspection.stderr).toBe(0); expect(JSON.parse(inspection.stdout).data).toMatchObject({ kind, dialect: strict ? "strict" : "transitional" });
      const raw = await shell.exec(`docx xml get /input --part '/${main}' --raw > /raw`); expect(raw.exitCode, raw.stderr).toBe(0); expect(raw.stdout).toBe(""); expect(await fs.readFile("/raw")).toEqual(parts.get(main));
      const edit = await shell.exec("docx text replace /input --find 'Original estuary' --with 'Updated estuary' --first --output /output --json"); expect(edit.exitCode, edit.stdout + edit.stderr).toBe(0); expect(JSON.parse(edit.stdout)).toMatchObject({ ok: true, affected: 1 });
      memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  expect([...saved.keys()].sort()).toEqual([...parts.keys()].sort());
  for (const [name, bytes] of parts) if (name !== main) expect(saved.get(name), name).toEqual(bytes);
  const expected = new TextDecoder().decode(parts.get(main)!).replace("<n:t>Original estuary", '<n:t xml:space="preserve">Updated estuary');
  expect(xmlStructure(saved.get(main)!)).toEqual(xmlStructure(encode(expected)));
  for (const trivia of ["<!--Retained prolog-->", "<!--Retained sibling-->", "<?audit keep?>"]) expect(new TextDecoder().decode(saved.get(main)!)).toContain(trivia);
  const reopened = await api.Document(output, textContext); expect(reopened.paragraphs[0]!.text).toBe("Updated estuary"); expect(reopened.part.content_type).toBe(fixture.type); expect(reopened.part.element.namespace).toBe(fixture.word);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const main of ["reports/a:b.xml", "report:2026/body.xml"])
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} saves a native part renamed to ${main}; ${kind} strict=${strict}`, async () => {
  const { input, parts, relationshipName } = colonPartFixture(strict, kind, "store", "reports/body.xml");
  const memory = Volume.fromJSON({ "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const operations = [
    { operation: "model.document.Document.part.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.partname.set", receiver: { resultHandle: "main" }, arguments: { value: "/" + main } }
  ];
  if (route === "model") { const doc = await api.Document(input, textContext); doc.part.partname = "/" + main; await doc.save(sink); }
  else if (route === "sdk") await (await api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).save(sink);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output), reopened = await api.Document(output, textContext);
  expect(String(reopened.part.partname)).toBe("/" + main); expect(reopened.paragraphs[0]!.text).toBe("Original estuary");
  expect(after.get(main)).toEqual(parts.get("reports/body.xml")); expect(after.has("reports/body.xml")).toBe(false);
  expect(after.get("archive/retained.bin")).toEqual(parts.get("archive/retained.bin"));
  const renamedRelationships = new api.PackURI("/" + main).rels_uri.membername;
  expect(after.has(relationshipName)).toBe(false); expect(new TextDecoder().decode(after.get(renamedRelationships)!)).toContain("<!--Inert resource-->");
  expect(reopened.part.rels.at("payload").target_part.blob).toEqual(parts.get("archive/retained.bin"));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const compression of ["store", "deflate"] as const)
for (const main of ["reports/a:b.xml", "report:2026/body.xml"])
it(`writes OPC part ${main} with independent member verification; ${kind} strict=${strict} ${compression}`, async () => {
  const { parts } = colonPartFixture(strict, kind, compression, main), memory = Volume.fromJSON({ "/output": "" });
  await api.writeDocumentArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/output", bytes); } }, { compression, order: "input" }, textContext);
  expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(parts);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const main of ["C:report.xml", "c:report.xml", "reports\\body.xml", "../reports/body.xml"])
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} retains unsafe path rejection for ${main}; ${kind} strict=${strict}`, async () => {
  const { input } = colonPartFixture(strict, kind, "store", main);
  expect(() => readPackage(input)).toThrow();
  if (route === "model") await expect(api.Document(input, textContext)).rejects.toMatchObject({ code: "invalid-container" });
  else if (route === "sdk") await expect(api.inspectDocument(input, textContext)).rejects.toMatchObject({ code: "invalid-container" });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/sentinel", encode("Retained"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx inspect /input --json"); expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, errors: [{ code: "invalid-container" }] }); expect(await fs.readFile("/sentinel")).toEqual(encode("Retained")); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const main of ["reports/a:b.xml", "report:2026/body.xml"])
for (const route of ["sdk", "shell"] as const)
it(`${route} keeps colon extraction refusal separate from in-package access; ${main} ${kind} strict=${strict}`, async () => {
  const { input } = colonPartFixture(strict, kind, "store", main), fs = new MemoryFileSystem();
  await fs.writeFile("/input", input); await fs.writeFile("/sentinel", encode("Retained"));
  expect((await api.inspectDocument(input, textContext)).kind).toBe(kind);
  if (route === "sdk") await expect(api.extractDocumentArchive(input, { outputDir: "/new", allowPartialOutput: true }, { ...textContext, filesystem: fs })).rejects.toMatchObject({ code: "invalid-container" });
  else {
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx extract /input --output-dir /new --allow-partial-output --json"); expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-container" }] }); }
    finally { await shell.dispose(); }
  }
  await expect(fs.lstat("/new")).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readFile("/sentinel")).toEqual(encode("Retained")); expect(await fs.readFile("/input")).toEqual(input);
});
