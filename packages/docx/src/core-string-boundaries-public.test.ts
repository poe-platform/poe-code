import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { readPackage } from "../tests/assertions.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
const enc = (text: string) => new TextEncoder().encode(text), dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes), ref = (resultHandle: string) => ({ resultHandle });
const fields = [
  ["title", "title", "dc:title"], ["subject", "subject", "dc:subject"], ["author", "author", "dc:creator"],
  ["keywords", "keywords", "cp:keywords"], ["comments", "comments", "dc:description"], ["last_modified_by", "lastModifiedBy", "cp:lastModifiedBy"],
  ["category", "category", "cp:category"], ["content_status", "contentStatus", "cp:contentStatus"], ["identifier", "identifier", "dc:identifier"],
  ["language", "language", "dc:language"], ["version", "version", "cp:version"]
] as const;
const boundary = "海🌊".repeat(127) + "e";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const [member, key, expanded] of fields) for (const route of ["model", "model-sdk", "model-cli", "sdk", "cli", "sdk-batch", "cli-batch"] as const)
for (const sample of [{ name: "empty", value: "", valid: true }, { name: "255-scalars", value: boundary, valid: true }, { name: "256-scalars", value: boundary + "́", valid: false }, { name: "null", value: null, valid: false }])
it(`core string public boundary; strict=${strict}; kind=${kind}; member=${member}; route=${route}; value=${sample.name}`, async () => {
  const accepted = sample.valid || route === "cli" && sample.value === null, expected = route === "cli" && sample.value === null ? "null" : sample.value;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retained</w:t></w:r></w:p>', {}, strict, { kind })), name = "native/properties.xml";
  const xml = `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><${expanded}>Original</${expanded}><f:opaque xmlns:f="urn:original:inert">Keep海🌊</f:opaque><!--native retain--><?audit exact?></cp:coreProperties>`;
  parts.set(name, enc(xml));
  const types = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!); types.insertChildren(types.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/${name}" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`); parts.set("[Content_Types].xml", types.serialize());
  const rels = new api.DocumentXmlEditor(parts.get("_rels/.rels")!); rels.insertChildren(rels.root, `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="nativeMetadata" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="${name}"/>`); parts.set("_rels/.rels", rels.serialize());
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } }, context = { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout: sink };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), modelOps = [{ operation: "model.document.Document.core_properties.get", receiver: ref("document"), arguments: {}, resultHandle: "core" }, { operation: `model.opc.coreprops.CoreProperties.${member}.set`, receiver: ref("core"), arguments: { value: sample.value } }, { operation: `model.opc.coreprops.CoreProperties.${member}.get`, receiver: ref("core"), arguments: {} }], utilityOps = [{ operation: "properties.set", arguments: { name: "core:" + key, value: sample.value } }];
  if (route === "model") {
    const doc = await api.Document(input, context), core = doc.core_properties as unknown as Record<string, unknown>;
    expect(core[member]).toBe("Original");
    if (accepted) { core[member] = sample.value; expect(core[member]).toBe(expected); }
    else expect(() => { core[member] = sample.value; }).toThrowError(expect.objectContaining({ code: "usage" }));
    await doc.save(sink);
    if (!accepted) { expect(new Uint8Array(memory.readFileSync("/output") as Buffer)).toEqual(input); memory.writeFileSync("/output", ""); }
  } else if (route === "model-sdk") {
    const pending = api.applyStyleModelBatch(input, { version: 1, operations: modelOps }, context);
    if (accepted) { const result = await pending; expect(result.results.at(-1)!.value).toBe(expected); await result.save(sink); }
    else await expect(pending).rejects.toMatchObject({ code: "usage", operationIndex: 1 });
  } else if (route === "sdk" || route === "sdk-batch") {
    const pending = route === "sdk" ? api.editDocumentProperties(input, { operation: "properties.set", name: "core:" + key, value: sample.value as string, output: "-" }, context) : api.executeDocumentBatch(input, { version: 1, operations: utilityOps }, { output: "-" }, context);
    if (accepted) await pending; else await expect(pending).rejects.toMatchObject({ code: "usage" });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const retained = enc("Retained forced destination"); await fs.writeFile("/destination", retained);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = route === "cli" ? `docx properties set /input --name core:${key} --value '${sample.value === null ? "null" : sample.value}'` : `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations: route === "model-cli" ? modelOps : utilityOps })}'`;
      const result = await shell.exec(command + " --output /destination --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(accepted ? 0 : 2);
      if (accepted) { if (route === "model-cli") expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe(expected); memory.writeFileSync("/output", await fs.readFile("/destination")); }
      else { expect(JSON.parse(result.stdout)).toMatchObject({ affected: 0, errors: [{ code: "usage" }] }); expect(await fs.readFile("/destination")).toEqual(retained); }
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (accepted) {
    const bytes = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(bytes), doc = await api.Document(bytes, context);
    expect((doc.core_properties as unknown as Record<string, unknown>)[member]).toBe(expected);
    expect(dec(after.get(name)!)).toContain('<f:opaque xmlns:f="urn:original:inert">Keep海🌊</f:opaque><!--native retain--><?audit exact?>');
    expect([...after.keys()]).toEqual([...parts.keys()]); for (const [part, payload] of parts) if (part !== name) expect(after.get(part), part).toEqual(payload);
  } else expect(memory.statSync("/output").size).toBe(0);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
