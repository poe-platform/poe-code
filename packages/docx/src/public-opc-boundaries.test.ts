import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocument, createDocxInspectionCommandEngine, inspectDocument, writeArchive } from "./index.js";
import { readPackage } from "../tests/assertions.js";
import { textContext } from "../tests/fixtures/text.js";

const enc = (value: string) => new TextEncoder().encode(value);
const pr = "http://schemas.openxmlformats.org/package/2006/relationships";
const ct = "http://schemas.openxmlformats.org/package/2006/content-types";
const relType = "application/vnd.openxmlformats-package.relationships+xml";
const relationships = (xml: string) => `<Relationships xmlns="${pr}">${xml}</Relationships>`;
const edge = (id: string, target: string, attrs = "", type = "urn:original:resource") => `<Relationship Id="${id}" Type="${type}" Target="${target}"${attrs}/>`;
const variants = [
  "control", "self-cycle", "internal-fragment", "external-inert", "reserved-names",
  "missing-types", "missing-root-relationships", "missing-main", "missing-target",
  "duplicate-default", "duplicate-override", "unknown-override", "relative-override", "types-override",
  "stray-types-text", "stray-relationship-text", "types-attribute", "types-child", "invalid-extension",
  "relationship-mime", "ordinary-relationship-mime", "undeclared-type", "orphan-owner",
  "duplicate-id", "missing-id", "invalid-id", "missing-target-attribute", "missing-type", "relative-type",
  "invalid-mode", "relationship-attribute", "relationship-child", "xml-base", "relationship-target",
  "absolute-internal", "internal-query", "root-escape", "root-empty-target", "external-main", "fragment-main", "duplicate-main",
  "case-collision", "derived-name", "encoded-unreserved", "encoded-slash", "encoded-backslash", "encoded-nul", "malformed-escape", "nfc-collision"
] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const compression of ["store", "deflate"] as const) for (const route of ["model", "sdk", "shell"] as const)
it.each(variants)(`${route} validates OPC %s with no partial publication; ${kind} strict=${strict} ${compression}`, async variant => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const mainType = `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml`;
  const declaration = `<Override PartName="/reports/main.xml" ContentType="${mainType}"/>`;
  const parts = new Map<string, Uint8Array>([
    ["[Content_Types].xml", enc(`<Types xmlns="${ct}"><Default Extension="rels" ContentType="${relType}"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="dat" ContentType="application/octet-stream"/>${declaration}</Types>`)],
    ["_rels/.rels", enc(relationships(edge("main", "reports/main.xml", "", r + "/officeDocument")))],
    ["reports/main.xml", enc(`<w:document xmlns:w="${word}"><w:body><w:p><!--retain--><w:r><w:t>Original coast</w:t></w:r><?audit keep?></w:p></w:body></w:document>`)],
    ["reports/_rels/main.xml.rels", enc(relationships(edge("shared", "../assets/shared.dat") + edge("side", "side.xml")))],
    ["reports/side.xml", enc('<audit xmlns="urn:original:audit">Retain data</audit>')],
    ["reports/_rels/side.xml.rels", enc(relationships(edge("shared", "../assets/shared.dat") + edge("back", "main.xml")))],
    ["assets/shared.dat", Uint8Array.of(0, 4, 255, 13)]
  ]);
  const change = (name: string, from: string, to: string) => parts.set(name, enc(new TextDecoder().decode(parts.get(name)!).replace(from, to)));
  const owner = "reports/_rels/main.xml.rels", types = "[Content_Types].xml";
  if (variant === "self-cycle") parts.set(owner, enc(relationships(edge("self", ""))));
  if (variant === "internal-fragment") parts.set(owner, enc(relationships(edge("fragment", "../assets/shared.dat#section./item%2Fdetail?view"))));
  if (variant === "external-inert") parts.set(owner, enc(relationships(edge("inert", "javascript:never-execute()", ' TargetMode="External"'))));
  if (variant === "reserved-names") for (const name of ["assets/%C3%89.dat", "assets/%C3%A9.dat", "assets/a%3Bb.dat", "assets/a;b.dat"]) parts.set(name, Uint8Array.of(9));
  if (variant === "missing-types") parts.delete(types);
  if (variant === "missing-root-relationships") parts.delete("_rels/.rels");
  if (variant === "missing-main") parts.delete("reports/main.xml");
  if (variant === "missing-target") parts.delete("assets/shared.dat");
  const extraType = variant === "duplicate-default" ? '<Default Extension="XML" ContentType="application/xml"/>' : variant === "duplicate-override" ? declaration.replace("/reports/main.xml", "/REPORTS/MAIN.XML") : variant === "unknown-override" ? '<Override PartName="/absent.xml" ContentType="application/xml"/>' : variant === "types-override" ? '<Override PartName="/[Content_Types].xml" ContentType="application/xml"/>' : "";
  if (extraType) change(types, "</Types>", extraType + "</Types>");
  if (variant === "relative-override") change(types, 'PartName="/reports/main.xml"', 'PartName="reports/main.xml"');
  if (variant === "stray-types-text") change(types, "</Types>", "stray</Types>");
  if (variant === "stray-relationship-text") change(owner, "</Relationships>", "stray</Relationships>");
  if (variant === "types-attribute") change(types, "<Types ", '<Types audit="unknown" ');
  if (variant === "types-child") change(types, "</Types>", "<Other/></Types>");
  if (variant === "invalid-extension") change(types, 'Extension="xml"', 'Extension=".xml"');
  if (variant === "relationship-mime") change(types, relType, "application/xml");
  if (variant === "ordinary-relationship-mime") change(types, "application/octet-stream", relType);
  if (variant === "undeclared-type") parts.set("assets/no.declaration", Uint8Array.of(7));
  if (variant === "orphan-owner") parts.set("ghost/_rels/missing.xml.rels", enc(relationships("")));
  if (variant === "duplicate-id") change(owner, 'Id="side"', 'Id="shared"');
  if (variant === "missing-id") change(owner, ' Id="shared"', "");
  if (variant === "invalid-id") change(owner, 'Id="shared"', 'Id="1invalid"');
  if (variant === "missing-target-attribute") change(owner, ' Target="../assets/shared.dat"', "");
  if (variant === "missing-type") change(owner, ' Type="urn:original:resource"', "");
  if (variant === "relative-type") change(owner, 'Type="urn:original:resource"', 'Type="relative-type"');
  if (variant === "invalid-mode") change(owner, 'Id="shared"', 'Id="shared" TargetMode="Remote"');
  if (variant === "relationship-attribute") change(owner, 'Id="shared"', 'Id="shared" audit="unknown"');
  if (variant === "relationship-child") change(owner, "</Relationships>", "<Other/></Relationships>");
  if (variant === "xml-base") change(owner, 'Id="shared"', 'Id="shared" xml:base="/other/"');
  const target = variant === "relationship-target" ? "_rels/side.xml.rels" : variant === "absolute-internal" ? "https://invalid.example/never" : variant === "internal-query" ? "side.xml?audit=1" : variant === "root-escape" ? "../../escape.dat" : undefined;
  if (target) change(owner, "../assets/shared.dat", target);
  if (variant === "root-empty-target") change("_rels/.rels", 'Target="reports/main.xml"', 'Target=""');
  if (variant === "external-main") change("_rels/.rels", 'Id="main"', 'Id="main" TargetMode="External"');
  if (variant === "fragment-main") change("_rels/.rels", 'Target="reports/main.xml"', 'Target="reports/main.xml#body"');
  if (variant === "duplicate-main") change("_rels/.rels", "</Relationships>", edge("main2", "reports/main.xml", "", r + "/officeDocument") + "</Relationships>");
  const name = variant === "case-collision" ? "REPORTS/SIDE.XML" : variant === "derived-name" ? "reports/side.xml/child.xml" : variant === "encoded-unreserved" ? "reports/%73ide.xml" : variant === "encoded-slash" ? "reports/a%2Fb.xml" : variant === "encoded-backslash" ? "reports/a%5Cb.xml" : variant === "encoded-nul" ? "reports/a%00b.xml" : variant === "malformed-escape" ? "reports/a%2.xml" : variant === "nfc-collision" ? "reports/cafe%CC%81.xml" : undefined;
  if (name) parts.set(name, enc("<inert/>"));
  if (variant === "nfc-collision") parts.set("reports/caf%C3%A9.xml", enc("<inert/>"));
  const valid = ["control", "self-cycle", "internal-fragment", "external-inert", "reserved-names"].includes(variant);
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = input.slice();
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    if (valid) { const model = await Document(input, textContext); expect(model.paragraphs[0]!.text).toBe("Original coast"); await model.save(sink); }
    else await expect(Document(input, textContext)).rejects.toMatchObject({ code: "invalid-package" });
  } else if (route === "sdk") {
    if (valid) { const inspection = await inspectDocument(input, textContext); expect(inspection).toMatchObject({ kind, dialect: strict ? "strict" : "transitional", counts: { paragraphs: 1 } }); }
    else await expect(inspectDocument(input, textContext)).rejects.toMatchObject({ code: "invalid-package" });
    const pending = createDocument({ template: input }, { output: "-" }, { ...textContext, encoding: { order: "input", compression }, stdout: sink });
    if (valid) await pending; else await expect(pending).rejects.toMatchObject({ code: "invalid-package" });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/misleading.bin", input); await fs.writeFile("/output", enc("sentinel"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    const read = await shell.exec("docx inspect /misleading.bin --json");
    expect(read.exitCode, read.stdout + read.stderr).toBe(valid ? 0 : 1);
    if (valid) expect(JSON.parse(read.stdout)).toMatchObject({ ok: true, affected: 0, data: { kind, dialect: strict ? "strict" : "transitional", counts: { paragraphs: 1 } } });
    else expect(JSON.parse(read.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-package" }] });
    const copied = await shell.exec("docx create --template /misleading.bin --output /output --force --json");
    expect(copied.exitCode, copied.stdout + copied.stderr).toBe(valid ? 0 : 1);
    if (valid) memory.writeFileSync("/output", await fs.readFile("/output"));
    else { expect(JSON.parse(copied.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-package" }] }); expect(await fs.readFile("/output")).toEqual(enc("sentinel")); }
    expect(await fs.readFile("/misleading.bin")).toEqual(before);
  }
  if (valid) {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer);
    expect(readPackage(output)).toEqual(parts); expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Original coast");
  } else expect(memory.readFileSync("/output")).toHaveLength(0);
  expect(input).toEqual(before); expect(memory.readFileSync("/input")).toEqual(Buffer.from(before));
});
