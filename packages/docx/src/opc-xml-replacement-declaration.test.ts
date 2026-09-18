import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { createDocxInspectionCommandEngine, replaceDocumentXmlPart, writeArchive } from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"])
for (const owner of ["types", "root", "document", "core", "signature", "generic"])
for (const codec of ["utf8", "utf16le", "utf16be", "explicit-le", "explicit-be"])
for (const route of ["sdk", "shell"])
it(`${route} replaces OPC ${owner} XML declaration ${codec}; ${kind} strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', {}, strict));
  const name = owner === "types" ? "[Content_Types].xml" : owner === "root" ? "_rels/.rels" : owner === "document" ? "word/_rels/document.xml.rels" : "assets/" + owner + ".xml";
  let types = new TextDecoder().decode(parts.get("[Content_Types].xml")!);
  if (kind === "dotx") types = types.replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml");
  if (["core", "signature", "generic"].includes(owner)) {
    const mime = owner === "core" ? "application/vnd.openxmlformats-package.core-properties+xml" : owner === "signature" ? "application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml" : "application/xml";
    types = types.replace("</Types>", `<Override PartName="/${name}" ContentType="${mime}"/></Types>`);
    parts.set(name, enc(owner === "core" ? '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>' : owner === "signature" ? '<s:Signature xmlns:s="http://www.w3.org/2000/09/xmldsig#"/>' : '<original xmlns="urn:original:generic"/>'));
  }
  parts.set("[Content_Types].xml", enc(types));
  const declaration = codec === "utf8" ? "UTF-8" : codec === "explicit-le" ? "uTf-16Le" : codec === "explicit-be" ? "UTF-16BE" : "UTF-16";
  const xml = `<?xml version='1.0' encoding = '${declaration}' standalone="yes"?>` + new TextDecoder().decode(parts.get(name)!);
  const little = codec === "utf16le" || codec === "explicit-le";
  const bytes = codec === "utf8" ? enc(xml) : new Uint8Array(little ? Buffer.from("\ufeff" + xml, "utf16le") : Buffer.from("\ufeff" + xml, "utf16le").swap16());
  parts.set(name, enc("<?xml version='1.0' encoding='UTF-8'?>" + new TextDecoder().decode(parts.get(name)!)));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const admitted = owner !== "signature" && (owner === "generic" || !codec.startsWith("explicit-"));
  const code = owner === "signature" ? "unsupported-edit" : "invalid-package";
  if (route === "sdk") {
    const result = replaceDocumentXmlPart(input, bytes, { part: "/" + name, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    if (admitted) expect(await result).toMatchObject({ changed: true, dryRun: false });
    else await expect(result).rejects.toMatchObject({ code });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement", bytes); await fs.writeFile("/output", enc("sentinel"));
    const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })).exec("docx xml set /input --part '/" + name + "' --file /replacement --output /output --force --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(admitted ? 0 : 1);
    if (admitted) memory.writeFileSync("/output", await fs.readFile("/output"));
    else { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code }] }); expect(await fs.readFile("/output")).toEqual(enc("sentinel")); }
    expect(await fs.readFile("/input")).toEqual(input);
  }
  if (admitted) {
    const saved = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
    for (const [part, original] of parts) expect(saved.get(part)).toEqual(part === name ? bytes : original);
  } else expect(memory.readFileSync("/output")).toHaveLength(0);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
