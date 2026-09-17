import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, applyStyleModelBatch, createDocxInspectionCommandEngine, decodeLocation, executeDocumentBatch, writeArchive } from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const select = [
  { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
  { operation: "model.text.paragraph.Paragraph.element.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "element" }
];

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "shell"] as const)
for (const mode of ["read", "change", "noop", "dry-run", "late-failure", "read-output"] as const)
it(`${route} reports exact model XML batch ${mode} effects and publication; ${kind} strict=${strict}`, async () => {
  const parts = readPackage(await textFixture(paragraph("Coastal record"), {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/model": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")})) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const read = mode === "read" || mode === "read-output", failed = mode === "late-failure" || mode === "read-output", changed = !read && mode !== "noop";
  const operations = [...select, ...(read ? [] : [
    { operation: "model.XmlElementView.set_attribute.call", receiver: ref("element"), arguments: { name: { namespaceURI: "", localName: "audit" }, value: mode === "noop" ? null : "kept" } }
  ]), { operation: "model.XmlElementView.attributes.get", receiver: ref("element"), arguments: {} },
  ...(mode === "late-failure" ? [{ operation: "model.text.paragraph.Paragraph.element.get", receiver: ref("paragraphs", 99), arguments: {} }] : [])];
  const batch = { version: 1, operations };
  if (!failed) {
    const model = await Document(input, textContext);
    if (!read) model.paragraphs[0]!.element.set_attribute({namespaceURI: "", localName: "audit"}, mode === "noop" ? null : "kept");
    await model.save({async write(bytes) { memory.appendFileSync("/model", bytes); }});
    const staged = readPackage(new Uint8Array(memory.readFileSync("/model") as Buffer));
    for (const [name, bytes] of parts) if (name !== "word/document.xml" || !changed) expect(staged.get(name)).toEqual(bytes);
    const applied = await applyStyleModelBatch(input, batch, textContext);
    expect(applied.results.at(-1)!.value).toEqual(changed ? [{key: {namespaceURI: "", localName: "audit"}, value: "kept"}] : []);
  }
  const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", enc("sentinel")); await fs.writeFile("/ops", enc(JSON.stringify(batch)));
  const options = mode === "read" ? {} : mode === "dry-run" ? { dryRun: true } : { output: "/output", force: true };
  let data: Awaited<ReturnType<typeof executeDocumentBatch>>;
  if (route === "sdk") {
    const pending = executeDocumentBatch(input, batch, options, { ...textContext, filesystem: fs, encoding: {order: "input", compression: "store"} });
    if (failed) { await expect(pending).rejects.toMatchObject(mode === "late-failure" ? {operationIndex: 4} : {code: "usage", exitCode: 2}); }
    else data = await pending;
  } else {
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const result = await shell.exec(`docx batch /input --ops-file /ops --json ${mode === "read" ? "" : mode === "dry-run" ? "--dry-run" : "--output /output --force"}`);
    expect(result.exitCode, result.stdout + result.stderr).toBe(failed ? mode === "read-output" ? 2 : 1 : 0);
    const envelope = JSON.parse(result.stdout);
    if (failed) {
      expect(envelope).toMatchObject({ok: false, data: null, affected: 0, locations: []});
      if (mode === "late-failure") expect(envelope.errors[0]).toMatchObject({operationIndex: 4});
    } else { expect(envelope).toMatchObject({ok: true, affected: changed ? 1 : 0}); data = envelope.data; }
  }
  expect(await fs.readFile("/input")).toEqual(input);
  if (failed || read || mode === "dry-run") expect(await fs.readFile("/output")).toEqual(enc("sentinel"));
  if (failed) return;
  expect(Object.keys(data!).sort()).toEqual(["publication", "results"]);
  expect(data!.results).toHaveLength(operations.length);
  for (const [index, result] of data!.results.entries()) {
    expect(Object.keys(result).sort()).toEqual(["affected", "data", "errors", "locations", "ok", "operation", "version", "warnings"]);
    expect(result).toMatchObject({version: 1, operation: operations[index]!.operation, ok: true, affected: changed && index === 2 ? 1 : 0, warnings: [], errors: []});
  }
  if (read) { expect(data!.publication).toBeNull(); return; }
  const publication = data!.publication!;
  expect(publication).toMatchObject({changed, dryRun: mode === "dry-run"});
  expect(publication.changes).toHaveLength(changed ? 1 : 0);
  if (changed) {
    const change = publication.changes[0]!;
    expect(change.kind).toBe("set");
    for (const [generation, location] of [change.before, change.after].entries()) {
      expect(location).toMatchObject({value: {part: "/word/document.xml", sourceSha256: hash(input), generation}});
      expect(decodeLocation(location!.token)).toEqual(location!.value);
    }
    expect(data!.results[2]!.locations).toEqual([change.after]);
  }
  if (mode === "dry-run") { expect(publication.output).toBeNull(); return; }
  const output = await fs.readFile("/output");
  expect(publication.output).toEqual({path: "/output", bytes: output.length, sha256: hash(output)});
  const after = readPackage(output);
  expect(after).toEqual(readPackage(new Uint8Array(memory.readFileSync("/model") as Buffer)));
  expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Coastal record");
});

for (const strict of [false, true]) for (const route of ["sdk", "shell"] as const)
it(`${route} reports and publishes the paragraph tab-stop getter's required creation; strict=${strict}`, async () => {
  const input = await textFixture(paragraph("Tab owner"), {}, strict);
  const batch = {version: 1, operations: [select[0],
    {operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "format"},
    {operation: "model.text.parfmt.ParagraphFormat.tab_stops.get", receiver: ref("format"), arguments: {}}
  ]};
  const memory = Volume.fromJSON({"/model": "", "/sdk": ""});
  const document = await Document(input, textContext); expect(document.paragraphs[0]!.paragraph_format.tab_stops.length).toBe(0);
  await document.save({async write(bytes) {memory.appendFileSync("/model", bytes);}});
  const expected = readPackage(new Uint8Array(memory.readFileSync("/model") as Buffer));
  expect(expected.get("word/document.xml")).not.toEqual(readPackage(input).get("word/document.xml"));
  const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify(batch)));
  let result: Awaited<ReturnType<typeof executeDocumentBatch>>;
  if (route === "sdk") result = await executeDocumentBatch(input, batch, {output: "/output"}, {...textContext, filesystem: fs, encoding: {order: "input", compression: "store"}});
  else {
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const output = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(output.exitCode, output.stdout + output.stderr).toBe(0); result = JSON.parse(output.stdout).data;
  }
  expect(result.publication).toMatchObject({changed: true, dryRun: false});
  expect(result.results.map(item => item.affected)).toEqual([0, 0, 1]);
  expect(readPackage(await fs.readFile("/output"))).toEqual(expected);
  expect(await fs.readFile("/input")).toEqual(input);
});
