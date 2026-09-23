import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { signatureFixture } from "../tests/fixtures/signatures.js";
import { textContext as fixtureContext } from "../tests/fixtures/text.js";
import { encodeWholeXmlFixture } from "../tests/fixtures/whole-xml-codec.js";
import { readPackage } from "../tests/assertions.js";
const textContext = { ...fixtureContext, encoding: { order: "input", compression: "store" } as const };


const compiled = await compiledPublicRuntime;
for (const runtime of ["source", "compiled"] as const)
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf8bom", "utf16le", "utf16be"] as const)
for (const scenario of ["ordinary", "unusual", "malformed-root", "encoded"] as const)
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`signature graph parts carry exact closed metadata and public schemas; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; scenario=${scenario}; route=${route}`, async () => {
  const api = runtime === "source" ? source : compiled;
  expect(compiled.Document).not.toBe(source.Document);
  expect(compiled.DocumentBudget).not.toBe(source.DocumentBudget);
  const archive = await api.readArchive(await signatureFixture(scenario), textContext);
  const members = archive.members.map(member => {
    if (!member.name.endsWith(".xml") && !member.name.endsWith(".rels")) return member;
    const xml = new TextDecoder().decode(member.bytes)
      .replaceAll("http://schemas.openxmlformats.org/wordprocessingml/2006/main", strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main")
      .replaceAll("http://schemas.openxmlformats.org/officeDocument/2006/relationships", strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
      .replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`);
    return { ...member, bytes: new TextEncoder().encode(xml) };
  });
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ ...archive, members }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = await encodeWholeXmlFixture(new Uint8Array(memory.readFileSync("/input") as Buffer), codec), original = input.slice();
  const before = readPackage(input), graph = (await api.readDocumentArchive(input, textContext)).package;
  expect((await api.validateDocument(input, textContext)).valid).toBe(true);
  const schema = api.getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "signatures.list" } })!.data as source.DocxSchemaData;
  const dataSchema = schema.operations[0]!.result.oneOf![0]!.properties!.data!;
  const details = (dataSchema.properties!.items!.items as source.DocxJsonSchema).properties!.details!;
  expect(details.required).toEqual(["kind", "parts"]);
  expect(details.additionalProperties).toBe(false);
  expect(details.properties!.parts!.items).toEqual({ type: "object", properties: { name: { type: "string" }, contentType: { type: "string" }, bytes: { type: "integer", minimum: 0 }, sha256: { type: "string" } }, required: ["name", "contentType", "bytes", "sha256"], additionalProperties: false });
  const batch = { version: 1 as const, operations: [{ operation: "signatures.list" as const, arguments: {} }] };
  let data: unknown;
  if (route === "sdk") data = await api.inspectDocumentSignatures(input, {}, textContext);
  else if (route === "sdk-batch") {
    const result = await api.executeDocumentBatch(input, batch, {}, { ...textContext, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } });
    expect(result.publication).toBeNull(); data = result.results[0]!.data;
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination");
    await fs.writeFile("/input", input); await fs.writeFile("/destination", destination); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const discovered = await shell.exec("docx schema --operation signatures.list --json");
      expect(discovered.exitCode, discovered.stdout + discovered.stderr).toBe(0);
      expect(JSON.parse(discovered.stdout).data.operations[0].result).toEqual(schema.operations[0]!.result);
      const response = await shell.exec((route === "cli" ? "docx signatures list /input" : "docx batch /input --ops-file /operations") + " --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(0);
      const envelope = JSON.parse(response.stdout); expect(envelope).toMatchObject({ ok: true, affected: 0, errors: [] });
      data = route === "cli" ? envelope.data : envelope.data.results[0].data;
      if (route === "cli-batch") expect(envelope.data.publication).toBeNull();
      const human = await shell.exec("docx signatures list /input");
      expect(human.exitCode, human.stdout + human.stderr).toBe(0);
      expect(human.stdout).toContain("Cryptographic validity: unknown (not verified)");
      expect(human.stdout).not.toContain("undefined");
      expect(await fs.readFile("/input")).toEqual(original);
      expect(await fs.readFile("/destination")).toEqual(destination);
    } finally { await shell.dispose(); }
  }
  const result = data as { items: { name: string; location: source.Location; details: unknown }[]; verified: unknown; relationships: unknown[] };
  expect(result.verified).toBeNull(); expect(result.items).toHaveLength(4); expect(result.relationships).toHaveLength(4);
  const directory = scenario === "encoded" ? "/★/" : "/seals/";
  expect(result.items.map(item => item.name)).toEqual(["cert.cer", "first.xml", "origin.sigs", "second.xml"].map(name => directory + name));
  for (const item of result.items) {
    const part = graph.getPart(item.name), bytes = part.bytes;
    expect(bytes).toEqual(before.get(part.name));
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))].map(value => value.toString(16).padStart(2, "0")).join("");
    expect(item.location.value.part).toBe(item.name);
    expect(item.details).toEqual({ kind: "signatures", parts: [{ name: item.name, contentType: part.content_type, bytes: bytes.length, sha256: hash }] });
  }
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(dataSchema);
  expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
  expect(input).toEqual(original); expect(memory.statSync("/output").size).toBe(0);
});
