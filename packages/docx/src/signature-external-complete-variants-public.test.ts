import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const native = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
const pr = "http://schemas.openxmlformats.org/package/2006/relationships";
function encodedXml(value: string, codec: string) {
  if (codec === "utf8") return encode(value);
  const bytes = Buffer.from("\ufeff" + value, "utf16le");
  if (codec === "utf16be") bytes.swap16();
  return new Uint8Array(bytes);
}
const scenarios = ["direct", "choice", "fallback", "process", "inactive", "lookalike"] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["root", "document"] as const) for (const codec of ["utf8", "utf16le", "utf16be"])
for (const scenario of scenarios) for (const route of ["sdk", "native-sdk", "cli", "native-cli"] as const)
it(`external signature exact declaration ${scenario}; strict=${strict}; kind=${kind}; owner=${owner}; codec=${codec}; route=${route}`, async () => {
  const product = route.startsWith("native") ? native : api, context = { signal: textContext.signal, limits: textContext.limits, encoding: { order: "input", compression: "store" } as const };
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original 海🌊</w:t></w:r></w:p>', {}, strict, { kind }));
  const relationshipName = owner === "root" ? "_rels/.rels" : "word/_rels/document.xml.rels";
  const originalRelationships = new TextDecoder().decode(parts.get(relationshipName)!);
  const type = scenario === "lookalike" ? "urn:original:digital-signature/signature" : pr + "/digital-signature/signature";
  const row = `<Relationship Id="externalSeal" Type="${type}" Target="https://credential.example.invalid/private-token/never-fetch" TargetMode="External"/>`;
  const declarations = `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:pr="${pr}" xmlns:u="urn:original:signature-carrier"`;
  const wrapper = scenario === "direct" || scenario === "lookalike" ? row : scenario === "process" ? `<u:bridge ${declarations} mc:Ignorable="u" mc:ProcessContent="u:bridge">${row}</u:bridge>` :
    `<mc:AlternateContent ${declarations}><mc:Choice Requires="${scenario === "fallback" ? "u" : "pr"}">${scenario === "choice" ? row : ""}</mc:Choice><mc:Fallback>${scenario === "choice" ? "" : row}</mc:Fallback></mc:AlternateContent>`;
  parts.set(relationshipName, encodedXml(originalRelationships.replace("</Relationships>", `<!--retain-->${wrapper}<?audit exact?></Relationships>`), codec));
  const memory = Volume.fromJSON({ "/input": "", "/output": "", "/forbidden": "" });
  await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice(), signed = scenario !== "inactive" && scenario !== "lookalike";
  const list = await product.inspectDocumentSignatures(input, {}, context);
  expect(list.items).toEqual([]); expect(list.verified).toBeNull();
  expect(list.relationships).toEqual(signed ? [{ owner: owner === "root" ? "/" : "/word/document.xml", id: "externalSeal", type, target: null, external: true }] : []);
  expect(JSON.stringify(list)).not.toContain("private-token");
  const document = await product.Document(input, context);
  if (signed) {
    expect(() => { document.paragraphs[0]!.text = "Forbidden"; }).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
    await expect(document.save({ async write(bytes: Uint8Array) { memory.appendFileSync("/forbidden", bytes); } })).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(document.paragraphs[0]!.text).toBe("Original 海🌊"); expect(memory.statSync("/forbidden").size).toBe(0);
  }
  if (route === "sdk" || route === "native-sdk") {
    const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
    const pending = product.replaceDocumentText(input, { find: "Original", with: "Changed", first: true, output: "-" }, { ...context, stdout: sink });
    if (signed) { await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" }); expect(memory.statSync("/output").size).toBe(0); }
    else { await pending; const ordinary = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer)); expect(ordinary.get(relationshipName)).toEqual(parts.get(relationshipName)); memory.writeFileSync("/output", ""); }
    const stripped = await product.stripDocumentSignatures(input, { output: "-", ...(!signed ? { allowEmpty: true } : {}) }, { ...context, stdout: sink });
    expect(stripped).toMatchObject({ changed: signed, removedParts: [], removedContentTypes: [], removedRelationships: signed ? list.relationships : [] });
  } else {
    const fs = new MemoryFileSystem(), retained = encode("Retained forced destination"); await fs.writeFile("/input", input); await fs.writeFile("/output", retained);
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const read = await shell.exec("docx signatures list /input --json"); expect(read.exitCode, read.stdout + read.stderr).toBe(0); expect(JSON.parse(read.stdout).data).toEqual(list);
      const ordinary = await shell.exec("docx text replace /input --find Original --with Changed --first --output /output --force --json");
      expect(ordinary.exitCode, ordinary.stdout + ordinary.stderr).toBe(signed ? 1 : 0);
      if (signed) { expect(JSON.parse(ordinary.stdout)).toMatchObject({ ok: false, affected: 0, data: null, errors: [{ code: "unsupported-edit" }] }); expect(await fs.readFile("/output")).toEqual(retained); }
      else expect(readPackage(await fs.readFile("/output")).get(relationshipName)).toEqual(parts.get(relationshipName));
      const strip = await shell.exec(`docx signatures remove /input --output /output --force${signed ? "" : " --allow-empty"} --json`);
      expect(strip.exitCode, strip.stdout + strip.stderr).toBe(0); expect(JSON.parse(strip.stdout)).toMatchObject({ ok: true, data: { changed: signed, removedParts: [], removedContentTypes: [], removedRelationships: signed ? list.relationships : [] } });
      memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  expect([...after.keys()]).toEqual([...parts.keys()]);
  for (const [name, bytes] of parts) if (name !== relationshipName) expect(after.get(name), name).toEqual(bytes);
  if (signed) {
    const expected = originalRelationships.replace("</Relationships>", `<!--retain-->${wrapper.replace(row, "")}<?audit exact?></Relationships>`);
    expect(after.get(relationshipName)).toEqual(encodedXml(expected, codec));
  } else { expect(after.get(relationshipName)).toEqual(parts.get(relationshipName)); expect(output).toEqual(input); }
  const relationshipBytes = Buffer.from(after.get(relationshipName)!);
  if (codec === "utf16be") relationshipBytes.swap16();
  const relationshipXml = relationshipBytes.toString(codec === "utf8" ? "utf8" : "utf16le");
  expect(xmlStructure(encode(relationshipXml)).children.find(child => typeof child !== "string")).toMatchObject({ name: `{${pr}}Relationships` });
  // The flat UTF8 graph observer checks retained internal edges; the complete
  // encoded payload assertion above independently binds every external carrier.
  const internalGraphWitness = new Map(after); internalGraphWitness.set(relationshipName, encode(originalRelationships)); assertPackageLinks(internalGraphWitness);
  expect((await product.validateDocument(output, context)).valid).toBe(true);
  expect((await product.inspectDocumentSignatures(output, {}, context)).relationships).toEqual([]);
  expect((await product.extractDocumentText(output, context)).text).toBe("Original 海🌊");
  expect(input).toEqual(original); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(original);
});
