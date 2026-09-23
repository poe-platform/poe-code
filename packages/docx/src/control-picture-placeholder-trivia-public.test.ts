import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const native = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { textContext } from "../tests/fixtures/text.js";
import { joinBytes, pngChunk, rasterPng } from "../tests/fixtures/raster.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
function replacementPng(color: "rgb" | "rgba") {
  const header = new Uint8Array(13), dimensions = new DataView(header.buffer); dimensions.setUint32(0, 1); dimensions.setUint32(4, 1); header.set([8, color === "rgb" ? 2 : 6], 8);
  const row = Uint8Array.from([0, 35, 80, 120, ...(color === "rgba" ? [255] : [])]);
  let a = 1, b = 0; for (const byte of row) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  const checksum = new Uint8Array(4); new DataView(checksum.buffer).setUint32(0, (b << 16 | a) >>> 0);
  const compressed = joinBytes(Uint8Array.from([120, 1, 1, row.length, 0, 255 - row.length, 255]), row, checksum);
  return joinBytes(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", compressed), pngChunk("IEND", new Uint8Array()));
}
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const scenario of ["rgb", "rgba", "crc", "interlaced", "missing", "multiple", "external", "stray", "opaque-property"] as const)
for (const route of ["sdk", "native-sdk", "cli", "native-cli", "sdk-batch", "native-sdk-batch", "cli-batch", "native-cli-batch"] as const)
it(`picture placeholder comment/PI fidelity ${scenario}; codec=${codec}; strict=${strict}; kind=${kind}; route=${route}`, async () => {
  const product = route.startsWith("native") ? native : api, context = { signal: textContext.signal, limits: textContext.limits, encoding: { order: "input", compression: "store" } as const };
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const a = strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const wp = strict ? "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing" : "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
  const pic = strict ? "http://purl.oclc.org/ooxml/drawingml/picture" : "http://schemas.openxmlformats.org/drawingml/2006/picture";
  const pr = "http://schemas.openxmlformats.org/package/2006/relationships";
  const drawing = (id: number) => `<w:r><w:drawing><d:inline xmlns:d="${wp}" xmlns:a="${a}" xmlns:p="${pic}"><d:extent cx="3600" cy="7200"/><d:docPr id="${id}" name="Owned original" descr="Retained blue"/><a:graphic><a:graphicData uri="${pic}"><p:pic><p:nvPicPr/><p:blipFill><a:blip r:embed="old"/><a:srcRect l="500"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:ext cx="3600" cy="7200"/></a:xfrm></p:spPr></p:pic></a:graphicData></a:graphic></d:inline></w:drawing></w:r>`;
  const old = rasterPng(), replacement = replacementPng(scenario === "rgb" ? "rgb" : "rgba");
  let pictureBytes = replacement;
  if (scenario === "crc") { pictureBytes = replacement.slice(); pictureBytes[20] = 2; }
  if (scenario === "interlaced") { const header = replacement.slice(16, 29); header[12] = 1; pictureBytes = joinBytes(replacement.slice(0, 8), pngChunk("IHDR", header), replacement.slice(33)); }
  const content = scenario === "missing" ? "<w:r/>" : scenario === "multiple" ? drawing(17) + drawing(19) : scenario === "stray" ? `<w:r><w:drawing><a:blip xmlns:a="${a}" r:embed="old"/></w:drawing></w:r>` : drawing(17);
  const parts = new Map<string, Uint8Array>([
    ["[Content_Types].xml", encode(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/archive/master.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml"/><Override PartName="/archive/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`)],
    ["_rels/.rels", encode(`<Relationships xmlns="${pr}"><Relationship Id="main" Type="${r}/officeDocument" Target="archive/master.xml"/></Relationships>`)],
    ["archive/_rels/master.xml.rels", encode(`<Relationships xmlns="${pr}"><Relationship Id="old" Type="${r}/image" Target="${scenario === "external" ? "https://example.invalid/no-fetch" : "media/original.png"}"${scenario === "external" ? ' TargetMode="External"' : ""}/><Relationship Id="settings" Type="${r}/settings" Target="settings.xml"/><Relationship Id="audit" Type="urn:original:inert" Target="https://example.invalid/no-fetch" TargetMode="External"/><!--edges retain--><?audit edges?></Relationships>`)],
    ["archive/master.xml", encode(`<w:document xmlns:w="${w}" xmlns:r="${r}"><w:body><w:p><w:r><w:t>Outside 海🌊</w:t></w:r></w:p><w:p><w:sdt><w:sdtPr><w:id w:val="7"/><w:tag w:val="picture"/><w:picture/><w:showingPlcHdr><!--placeholder retain 海🌊--><?audit   placeholder exact  ?></w:showingPlcHdr><w:placeholder><w:docPart w:val="Retained definition"/></w:placeholder>${scenario === "opaque-property" ? '<u:metadata xmlns:u="urn:original:control" value="retained"/>' : ""}<!--properties retain--><?audit properties?></w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>${drawing(18)}</w:p><!--body retain--><?audit body?></w:body></w:document>`)],
    ["archive/settings.xml", encode(`<w:settings xmlns:w="${w}"><w:compat/><!--settings retain--></w:settings>`)],
    ["archive/media/original.png", old]
  ]);
  const decoding = codec === "utf8" ? "utf-8" : codec === "utf16le" ? "utf-16le" : "utf-16be";
  for (const [name, bytes] of parts) if (name.endsWith(".xml") || name.endsWith(".rels")) {
    const originalXml = new TextDecoder().decode(bytes);
    if (codec !== "utf8") { const buffer = Buffer.from("\ufeff" + originalXml, "utf16le"); if (codec === "utf16be") buffer.swap16(); parts.set(name, new Uint8Array(buffer)); }
    expect(new TextDecoder(decoding, { fatal: true }).decode(parts.get(name)!)).toBe(originalXml);
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }); await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice(), rejected = !["rgb", "rgba", "opaque-property"].includes(scenario);
  const file = { kind: "bytes" as const, base64: Buffer.from(pictureBytes).toString("base64") };
  const batch = { version: 1, operations: [{ operation: "controls.set", arguments: { control: 1, file } }] };
  if (route.includes("sdk")) {
    const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
    const pending = route.endsWith("batch") ? product.executeDocumentBatch(input, batch, { output: "-" }, { ...context, stdout: sink }) : product.editDocumentControls(input, { control: 1, file, output: "-" }, { ...context, stdout: sink });
    if (rejected) await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" });
    else expect(await pending).toMatchObject(route.endsWith("batch") ? { publication: { changed: true } } : { changed: true });
  } else {
    const fs = new MemoryFileSystem(), retained = encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/output", retained); await fs.writeFile("/new pixel.png", pictureBytes); await fs.writeFile("/ops", encode(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec((route.endsWith("batch") ? "docx batch /input --ops-file /ops" : "docx controls set /input --control 1 --file '/new pixel.png'") + " --output /output --force --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(rejected ? 1 : 0);
      if (rejected) { expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] }); expect(await fs.readFile("/output")).toEqual(retained); }
      else { expect(JSON.parse(response.stdout)).toMatchObject(route.endsWith("batch") ? { ok: true, data: { publication: { changed: true } } } : { ok: true, data: { changed: true } }); memory.writeFileSync("/output", await fs.readFile("/output")); }
      expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/new pixel.png")).toEqual(pictureBytes);
    } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original); expect(readPackage(input)).toEqual(parts);
  if (rejected) { expect(memory.statSync("/output").size).toBe(0); return; }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output), images = [...after.keys()].filter(name => name.endsWith(".png"));
  expect(images).toHaveLength(2); expect(after.get(images.find(name => name !== "archive/media/original.png")!)).toEqual(replacement);
  for (const [name, bytes] of parts) if (!["archive/master.xml", "archive/_rels/master.xml.rels", "[Content_Types].xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
  const xml = new TextDecoder(decoding, { fatal: true }).decode(after.get("archive/master.xml")!); expect(xml).toContain("<!--placeholder retain 海🌊--><?audit   placeholder exact  ?>");
  if (codec !== "utf8") for (const name of ["archive/master.xml", "archive/_rels/master.xml.rels", "[Content_Types].xml"]) expect([...after.get(name)!.slice(0, 2)]).toEqual(codec === "utf16be" ? [254, 255] : [255, 254]); expect(xml).toContain(drawing(18)); expect(xml).toContain('cx="3600" cy="7200"'); expect(xml).toContain('<a:srcRect l="500"/>'); expect(xml).toContain('descr="Retained blue"'); expect(xml).toContain("Retained definition"); expect(xml).not.toContain("showingPlcHdr");
  expect(xml).toContain("<!--properties retain--><?audit properties?>"); expect(xml).toContain("<!--body retain--><?audit body?>"); if (scenario === "opaque-property") expect(xml).toContain('<u:metadata xmlns:u="urn:original:control" value="retained"/>');
  const edges = xmlStructure(encode(new TextDecoder(decoding, { fatal: true }).decode(after.get("archive/_rels/master.xml.rels")!))).children.find(child => typeof child !== "string"); if (!edges || typeof edges === "string") throw new Error("Missing native relationship root");
  expect(edges.children.filter(child => typeof child !== "string" && child.name === `{${pr}}Relationship`)).toEqual(expect.arrayContaining([{ name: `{${pr}}Relationship`, attributes: { "{}Id": "old", "{}Type": `${r}/image`, "{}Target": "media/original.png" }, children: [] }, { name: `{${pr}}Relationship`, attributes: { "{}Id": "audit", "{}Type": "urn:original:inert", "{}Target": "https://example.invalid/no-fetch", "{}TargetMode": "External" }, children: [] }]));
  const snapshot = (await product.inspectDocumentControls(output, {}, context)).items[0]!; expect(snapshot).toMatchObject({ kind: "picture", id: "7", tag: "picture", placeholder: false, value: { external: false, contentType: "image/png" } }); expect((snapshot.value as api.ControlPicture).relationshipId).not.toBe("old");
  expect((await product.validateDocument(output, context)).valid).toBe(true); expect((await product.extractDocumentText(output, context)).text).toBe("Outside 海🌊\n"); expect(input).toEqual(original);
});
