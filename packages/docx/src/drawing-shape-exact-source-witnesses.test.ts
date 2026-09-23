import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { drawingShapeSourceCases, drawingShapeSourceXml } from "../tests/fixtures/drawing-shape-exact-source.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) }), enc = (s: string) => new TextEncoder().encode(s);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const c of drawingShapeSourceCases) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} independently executes exact drawing/shape witness R${c.row}; variant=${"index" in c ? c.index : c.action}; ${kind}; strict=${strict}`, async () => {
  const f = drawingShapeSourceXml(c, strict), parts = readPackage(await textFixture(f.paragraph + '<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p><!--retained--><?policy keep?>', {}, strict)), r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  if (f.embedded) { parts.set("word/media/image1.png", rasterPng(2, 3)); parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>'))); }
  const rels = (f.embedded ? `<Relationship Id="rId1" Type="${r}/image" Target="media/image1.png"/>` : '') + (f.linked ? `<Relationship Id="rId2" Type="${r}/image" Target="https://inert.example.invalid/image.png" TargetMode="External"/>` : '');
  parts.set("word/_rels/document.xml.rels", enc(new TextDecoder().decode(parts.get("word/_rels/document.xml.rels")).replace("</Relationships>", rels + '<!--retained relationship--><?policy keep?></Relationships>')));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const v = Volume.fromJSON({ "/input": "", "/out": "" }); await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { v.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(v.readFileSync("/input") as Buffer), reject = c.action === "image-reject" || c.action === "bounds", operations: Record<string, unknown>[] = [];
  if (["predicate", "image", "image-reject"].includes(c.action)) {
    operations.push({ operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "ps" }, { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("ps", 0), arguments: {}, resultHandle: "runs" }, { operation: "model.text.run.Run.iter_inner_content.call", receiver: ref("runs", 0), arguments: {}, resultHandle: "content" }, { operation: `model.drawing.Drawing.${c.action === "predicate" ? "has_picture" : "image"}.get`, receiver: ref("content", 0), arguments: {}, resultHandle: "value" });
    if (c.action === "image") operations.push({ operation: "model.image.image.Image.blob.get", receiver: ref("value"), arguments: {} });
  } else {
    operations.push({ operation: "model.document.Document.inline_shapes.get", receiver: ref("document"), arguments: {}, resultHandle: "shapes" });
    if (c.action === "count") operations.push({ operation: "model.shape.InlineShapes.__len__.get", receiver: ref("shapes"), arguments: {} });
    else if (c.action === "iter") operations.push({ operation: "model.shape.InlineShapes.__iter__.call", receiver: ref("shapes"), arguments: {} });
    else if (c.action === "index" || c.action === "bounds") for (const index of c.action === "bounds" && "index" in c ? [c.index] : [-2, -1, 0, 1]) operations.push({ operation: "model.shape.InlineShapes.__getitem__.get", receiver: ref("shapes"), arguments: { index } });
    else if (c.action === "owner") operations.push({ operation: "model.shape.InlineShapes.part.get", receiver: ref("shapes"), arguments: {}, resultHandle: "owner" }, { operation: "model.parts.document.DocumentPart.partname.get", receiver: ref("owner"), arguments: {} });
    else { operations.push({ operation: "model.shape.InlineShapes.__getitem__.get", receiver: ref("shapes"), arguments: { index: 0 }, resultHandle: "shape" }); if (c.action === "set") for (const [key, value] of [["width", 444], ["height", 888]]) operations.push({ operation: `model.shape.InlineShape.${key}.set`, receiver: ref("shape"), arguments: { value: { value, unit: "emu" } } }); for (const member of c.action === "type" ? ["type"] : ["width", "height"]) operations.push({ operation: `model.shape.InlineShape.${member}.get`, receiver: ref("shape"), arguments: {} }); }
  }
  const observe = (values: unknown[]) => {
    if (c.action === "predicate") expect(values.at(-1)).toBe(c.expected);
    else if (c.action === "image") expect(values.at(-1)).toEqual({ kind: "bytes", base64: Buffer.from(rasterPng(2, 3)).toString("base64") });
    else if (c.action === "count") expect(values.at(-1)).toBe(2);
    else if (c.action === "iter") { expect(values.at(-1) as unknown[]).toHaveLength(2); expect((values.at(-1) as { type: string }[]).every(x => x.type === "InlineShape")).toBe(true); }
    else if (c.action === "index") for (const v of values.slice(-4)) expect(v).toMatchObject({ type: "InlineShape" });
    else if (c.action === "owner") { expect(values.at(-2)).toMatchObject({ type: "DocumentPart" }); expect(values.at(-1)).toBe("/word/document.xml"); }
    else if (c.action === "type") expect(values.at(-1)).toEqual({ enum: "WD_INLINE_SHAPE_TYPE", name: c.expected });
    else expect(values.slice(-2)).toEqual([c.action === "set" ? 444 : 333, c.action === "set" ? 888 : 666].map(value => ({ value, unit: "emu" })));
  };
  const sink = { async write(bytes: Uint8Array) { v.appendFileSync("/out", bytes); } };
  if (route === "model") {
    const doc = await api.Document(input, textContext), shapes = doc.inline_shapes;
    if (["predicate", "image", "image-reject"].includes(c.action)) { const d = [...doc.paragraphs[0]!.runs[0]!.iter_inner_content()][0] as api.Drawing; if (c.action === "predicate") expect(d.has_picture).toBe(c.expected); else if (reject) expect(() => d.image).toThrowError(expect.objectContaining({ code: "missing-selection" })); else { expect(d.has_picture).toBe(true); expect(d.image.blob).toEqual(rasterPng(2, 3)); } }
    else if (c.action === "bounds" && "index" in c) expect(() => shapes.at(c.index)).toThrow(api.BoundsError);
    else if (c.action === "count") expect(shapes.length).toBe(2);
    else if (c.action === "iter") { expect([...shapes]).toHaveLength(2); expect([...shapes].every(s => s instanceof api.InlineShape)).toBe(true); }
    else if (c.action === "index") for (const index of [-2, -1, 0, 1]) expect(shapes.at(index)).toBeInstanceOf(api.InlineShape);
    else if (c.action === "owner") expect(shapes.part).toBe(doc.part);
    else { const s = shapes.at(0); if (c.action === "type") expect(s.type.name).toBe(c.expected); else { if (c.action === "set") { s.width = api.Emu(444); s.height = api.Emu(888); } expect(Object.isFrozen(s.width)).toBe(true); expect(Object.isFrozen(s.height)).toBe(true); expect([s.width.unit, s.height.unit]).toEqual(["emu", "emu"]); expect(() => Number(s.width)).toThrow(api.InputTypeError); expect([s.width.emu, s.height.emu]).toEqual(c.action === "set" ? [444, 888] : [333, 666]); } }
    if (!reject) await doc.save(sink);
  } else if (route === "sdk") { if (reject) await expect(api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).rejects.toMatchObject({ code: "missing-selection" }); else { const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); observe(result.results.map(r => r.value)); await result.save(sink); } }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", enc("original destination")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations }))); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const r = await shell.exec("docx batch /input --ops-file /ops --json" + (c.action === "set" ? " --output /out" : "")); expect(r.exitCode, r.stdout + r.stderr).toBe(reject ? 1 : 0); const env = JSON.parse(r.stdout); if (reject) { expect(env.errors[0].code).toBe("missing-selection"); expect(env.affected).toBe(0); } else observe(env.data.results.map((i: { data: unknown }) => i.data)); if (!reject) v.writeFileSync("/out", c.action === "set" ? await fs.readFile("/out") : input); expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/destination")).toEqual(enc("original destination")); } finally { await shell.dispose(); } }
  if (!reject) { const saved = readPackage(new Uint8Array(v.readFileSync("/out") as Buffer)); assertPackageLinks(saved); for (const [name, bytes] of parts) if (name !== "word/document.xml" || c.action !== "set") expect(saved.get(name), name).toEqual(bytes); if (c.action === "set") { const xml = new TextDecoder().decode(saved.get("word/document.xml")); expect(xml).toContain('cx="444" cy="888"'); expect(xml.split('cx="444" cy="888"')).toHaveLength(3); expect(xml).toContain('<!--retained--><?policy keep?>'); } const doc = await api.Document(new Uint8Array(v.readFileSync("/out") as Buffer), textContext); expect(doc.paragraphs[1]!.text).toBe("Retain é 日本 עברית 🌊"); }
  else expect(v.readFileSync("/out")).toHaveLength(0);
  expect(v.readFileSync("/input")).toEqual(Buffer.from(input));
});
