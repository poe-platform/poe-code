import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage } from "../tests/assertions.js";

const compiled = await compiledPublicRuntime;
const limits = { ...textContext.limits, maxArchiveBytes: 8 * 1024 * 1024, maxEntryBytes: 4 * 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024, maxRetainedBytes: 1024 * 1024 * 1024 };
for (const runtime of ["source", "compiled"] as const)
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf8bom", "utf16le", "utf16be"] as const)
for (const carrier of ["inline", "anchor"] as const) for (const depth of [32, 8192])
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`picture controls retain unrelated admitted native property depth; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; carrier=${carrier}; depth=${depth}; route=${route}`, async () => {
  const api = runtime === "source" ? source : compiled;
  expect(compiled.Document).not.toBe(source.Document); expect(compiled.DocumentBudget).not.toBe(source.DocumentBudget);
  const context = () => ({ signal: textContext.signal, limits, encoding: { order: "input", compression: "store" } as const, budget: new api.DocumentBudget({ xmlDepth: 32768, retainedBytes: 1024 * 1024 * 1024 }, textContext.signal) });
  const base = strict ? "http://purl.oclc.org/ooxml/" : "http://schemas.openxmlformats.org/";
  const w = base + (strict ? "wordprocessingml/main" : "wordprocessingml/2006/main");
  const r = base + (strict ? "officeDocument/relationships" : "officeDocument/2006/relationships");
  const a = base + (strict ? "drawingml/main" : "drawingml/2006/main");
  const wp = base + (strict ? "drawingml/wordprocessingDrawing" : "drawingml/2006/wordprocessingDrawing");
  const pic = base + (strict ? "drawingml/picture" : "drawingml/2006/picture");
  const pr = "http://schemas.openxmlformats.org/package/2006/relationships";
  const nativeProperties = `<w:rPr><w:b/><w:lang w:val="en-US"/><!--owned property 海--><?owned exact  ?>${"<u:x>".repeat(depth)}<u:leaf value="retained"/>${"</u:x>".repeat(depth)}</w:rPr>`;
  const position = carrier === "anchor" ? '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>-12</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:align>top</wp:align></wp:positionV>' : "";
  const attributes = carrier === "anchor" ? ' relativeHeight="3" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1" simplePos="0"' : "";
  const drawing = `<w:r>${nativeProperties}<w:drawing><wp:${carrier} distT="10" distB="20" distL="30" distR="40"${attributes}>${position}<wp:extent cx="1828800" cy="914400"/>${carrier === "anchor" ? '<wp:wrapSquare wrapText="bothSides" distL="70"/>' : ""}<wp:docPr id="17" name="Owned figure" descr="Retained alt"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="${pic}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Owned picture"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="old"/><a:srcRect l="1000" r="2000" t="3000" b="4000"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm rot="12000"><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:${carrier}></w:drawing></w:r>`;
  const control = `<w:sdt><w:sdtPr><w:id w:val="7"/><w:tag w:val="picture"/><w:picture/><w:showingPlcHdr/><w:placeholder><w:docPart w:val="Retained definition"/></w:placeholder></w:sdtPr><w:sdtContent>${drawing}</w:sdtContent></w:sdt>`;
  const old = rasterPng(), replacement = old.slice();
  const originals = new Map<string, string>([
    ["[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/archive/master.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml"/></Types>`],
    ["_rels/.rels", `<Relationships xmlns="${pr}"><Relationship Id="main" Type="${r}/officeDocument" Target="archive/master.xml"/></Relationships>`],
    ["archive/_rels/master.xml.rels", `<Relationships xmlns="${pr}"><Relationship Id="old" Type="${r}/image" Target="media/old.png"/><Relationship Id="audit" Type="urn:original:inert" Target="https://example.invalid/no-fetch" TargetMode="External"/><!--edges--><?owned edges?></Relationships>`],
    ["archive/master.xml", `<w:document xmlns:w="${w}" xmlns:r="${r}" xmlns:a="${a}" xmlns:wp="${wp}" xmlns:pic="${pic}" xmlns:u="urn:original:future" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="u"><w:body><w:p><w:r><w:t>Outside 海🌊</w:t></w:r></w:p><w:p>${control}</w:p><w:sectPr/></w:body></w:document>`]
  ]);
  const encode = (text: string): Uint8Array => {
    if (codec === "utf8") return new TextEncoder().encode(text);
    if (codec === "utf8bom") return new Uint8Array(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]));
    const payload = Buffer.from(text, "utf16le"); if (codec === "utf16be") payload.swap16();
    return new Uint8Array(Buffer.concat([Buffer.from(codec === "utf16le" ? [0xff, 0xfe] : [0xfe, 0xff]), payload]));
  };
  const parts = new Map([...originals].map(([name, text]) => [name, encode(text)])); parts.set("archive/media/old.png", old);
  const memory = Volume.fromJSON({ "/input": "", "/saved": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, context().encoding, context());
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice(), before = readPackage(input);
  expect(before).toEqual(parts);
  for (const [name, text] of originals) {
    const bytes = before.get(name)!;
    const prefix = codec === "utf8bom" ? [0xef, 0xbb, 0xbf] : codec === "utf16le" ? [0xff, 0xfe] : codec === "utf16be" ? [0xfe, 0xff] : [];
    if (prefix.length) expect([...bytes.subarray(0, prefix.length)]).toEqual(prefix);
    expect(new TextDecoder(codec === "utf16le" ? "utf-16le" : codec === "utf16be" ? "utf-16be" : "utf8", { fatal: true }).decode(bytes)).toBe(text);
  }
  expect((await api.validateDocument(input, context())).valid).toBe(true);
  const document = await api.Document(input, context()); expect(document.paragraphs[0]!.text).toBe("Outside 海🌊");
  await document.save({ async write(bytes: Uint8Array) { memory.appendFileSync("/saved", bytes); } }); expect(new Uint8Array(memory.readFileSync("/saved") as Buffer)).toEqual(original);
  const readBatch = { version: 1 as const, operations: [{ operation: "controls.list" as const, arguments: { control: 1 } }] };
  const setBatch = { version: 1 as const, operations: [{ operation: "controls.set" as const, arguments: { control: 1, file: { kind: "bytes" as const, base64: Buffer.from(replacement).toString("base64") } } }] };
  let value: source.ControlReadData, output: Uint8Array;
  if (route === "sdk" || route === "sdk-batch") {
    if (route === "sdk") value = await api.inspectDocumentControls(input, { control: 1 }, context());
    else { const result = await api.executeDocumentBatch(input, readBatch, {}, context()); expect(result.publication).toBeNull(); value = result.results[0]!.data as source.ControlReadData; }
    expect(value.items).toHaveLength(1); expect(value.items[0]).toMatchObject({ kind: "picture", id: "7", tag: "picture", lock: "unlocked", placeholder: true, support: "supported", reason: null, value: { relationshipId: "old", target: "/archive/media/old.png", external: false, contentType: "image/png" } });
    const publication = { ...context(), stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
    if (route === "sdk") expect(await api.editDocumentControls(input, { control: 1, file: setBatch.operations[0]!.arguments.file, output: "-" }, publication)).toMatchObject({ changed: true });
    else expect((await api.executeDocumentBatch(input, setBatch, { output: "-" }, publication)).publication).not.toBeNull();
    output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  } else {
    const fs = new MemoryFileSystem(), retained = new TextEncoder().encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/output", retained); await fs.writeFile("/pixel.png", replacement); await fs.writeFile("/read", new TextEncoder().encode(JSON.stringify(readBatch))); await fs.writeFile("/set", new TextEncoder().encode(JSON.stringify(setBatch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits: { xmlDepth: 32768, retainedBytes: 1024 * 1024 * 1024 } }) }));
    try {
      const read = await shell.exec((route === "cli" ? "docx controls list /input --control 1" : "docx batch /input --ops-file /read") + " --json"); expect(read.exitCode, read.stdout + read.stderr).toBe(0);
      const envelope = JSON.parse(read.stdout); expect(envelope).toMatchObject({ ok: true, affected: 0, errors: [] }); value = route === "cli" ? envelope.data : envelope.data.results[0].data;
      expect(value.items).toHaveLength(1); expect(value.items[0]).toMatchObject({ kind: "picture", id: "7", tag: "picture", lock: "unlocked", placeholder: true, support: "supported", reason: null, value: { relationshipId: "old", target: "/archive/media/old.png", external: false, contentType: "image/png" } });
      expect(await fs.readFile("/output")).toEqual(retained);
      const result = await shell.exec((route === "cli" ? "docx controls set /input --control 1 --file /pixel.png" : "docx batch /input --ops-file /set") + " --output /output --force --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, errors: [] });
      output = await fs.readFile("/output"); expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/pixel.png")).toEqual(replacement);
    } finally { await shell.dispose(); }
  }
  const after = readPackage(output!); for (const [name, bytes] of before) if (!["archive/master.xml", "archive/_rels/master.xml.rels", "[Content_Types].xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
  const media = [...after.keys()].filter(name => name.endsWith(".png")); expect(media).toHaveLength(2); expect(after.get(media.find(name => name !== "archive/media/old.png")!)).toEqual(replacement);
  const xml = new TextDecoder(codec === "utf16le" ? "utf-16le" : codec === "utf16be" ? "utf-16be" : "utf8", { fatal: true }).decode(after.get("archive/master.xml")!);
  expect(xml).toContain(nativeProperties); expect(xml).toContain('descr="Retained alt"'); expect(xml).toContain('<a:srcRect l="1000" r="2000" t="3000" b="4000"/>'); expect(xml).toContain('rot="12000"'); expect(xml).toContain(position); expect(xml).toContain('cx="1828800" cy="914400"'); expect(xml).toContain("Retained definition"); expect(xml).not.toContain("showingPlcHdr");
  const expected = originals.get("archive/master.xml")!.replace('<w:showingPlcHdr/>', ""); const newId = (await api.inspectDocumentControls(output!, { control: 1 }, context())).items[0]!.value as source.ControlPicture;
  expect(newId.relationshipId).not.toBe("old"); expect(xml).toBe(expected.replace('r:embed="old"', `r:embed="${newId.relationshipId}"`));
  const edges = new TextDecoder(codec === "utf16le" ? "utf-16le" : codec === "utf16be" ? "utf-16be" : "utf8", { fatal: true }).decode(after.get("archive/_rels/master.xml.rels")!); expect(edges).toContain('<Relationship Id="old" Type="' + r + '/image" Target="media/old.png"/>'); expect(edges).toContain('<Relationship Id="audit" Type="urn:original:inert" Target="https://example.invalid/no-fetch" TargetMode="External"/>'); expect(edges).toContain('<!--edges--><?owned edges?>');
  for (const name of ["archive/master.xml", "archive/_rels/master.xml.rels", "[Content_Types].xml"]) { const bytes = after.get(name)!; if (codec === "utf16le" || codec === "utf16be") expect([...bytes.subarray(0, 2)]).toEqual(codec === "utf16le" ? [0xff, 0xfe] : [0xfe, 0xff]); else if (codec === "utf8bom") expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); }
  expect((await api.validateDocument(output!, context())).valid).toBe(true); expect(input).toEqual(original); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(original);
});
