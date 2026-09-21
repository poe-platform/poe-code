import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

import { variants, fixture, inert } from "../tests/fixtures/native-text-raster.js";

for (const variant of variants)
for (const dialect of ["transitional", "strict"] as const) for (const kind of ["docx", "dotx"] as const)
for (const path of ["model", "direct"] as const)
for (const action of ["run-text", "run-clear", "paragraph-text", "paragraph-clear"] as const)
it.concurrent(`replaces supported native raster content without changing its shared outside owner; ${dialect}; ${kind}; ${path}; ${action}${variant.label}`, async () => {
  const input = await fixture(dialect, kind, variant), parts = readPackage(input);
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "", "/destination": "Original retained destination" });
  const sink = (path: string) => ({ async write(bytes: Uint8Array) { memory.appendFileSync(path, bytes); } });
  if (variant.inactive) expect(new TextDecoder().decode(parts.get("word/document.xml")!)).toContain(inert);
  const document = await api.Document(input, textContext), paragraph = document.paragraphs[0]!, run = paragraph.runs[0]!;
  expect(document.inline_shapes.length).toBe(variant.floating ? 1 : 2);
  const replacement = "Replacement 🌊 日本 עברית";
  let edited = document;
  if (path === "direct") {
    const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink("/output") };
    if (action.startsWith("run")) await api.formatDocumentRuns(input, { paragraph: 1, run: 1, text: action.endsWith("clear") ? "" : replacement, output: "-" }, context);
    else await api.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { paragraph: 1, text: action.endsWith("clear") ? "" : replacement, output: "-" } }, context);
    edited = await api.Document(new Uint8Array(memory.readFileSync("/output") as Buffer), textContext);
  } else if (action === "run-text") run.text = replacement;
  else if (action === "run-clear") expect(run.clear().equals(run)).toBe(true);
  else if (action === "paragraph-text") paragraph.text = replacement;
  else expect(paragraph.clear().equals(paragraph)).toBe(true);
  const changedParagraph = edited.paragraphs[0]!, changedRun = changedParagraph.runs.length ? changedParagraph.runs[0] : undefined;
  expect(changedParagraph.text).toBe(action.endsWith("clear") ? "" : replacement);
  expect(changedParagraph.alignment).toBe(api.WD_ALIGN_PARAGRAPH.RIGHT);
  expect(changedParagraph.paragraph_format.keep_with_next).toBe(true);
  if (action.startsWith("run")) { expect(changedRun!.bold).toBe(true); expect(changedRun!.font.rtl).toBe(true); }
  else expect(changedParagraph.runs.every(value => value.bold === null && value.font.rtl === null)).toBe(true);
  expect(edited.inline_shapes.length).toBe(1);
  expect(document.paragraphs[1]!.text).toBe("Unselected é海");
  expect(document.paragraphs[1]!.runs[0]!.italic).toBe(true);
  if (path === "model") await document.save(sink("/output"));
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  if (variant.inactive) expect(new TextDecoder().decode(after.get("word/document.xml")!)).toContain(inert);
  expect((await api.inspectDocument(output, textContext)).counts.images).toBe(1);
  const reopened = await api.Document(output, textContext);
  expect(reopened.inline_shapes.length).toBe(1);
  expect(reopened.paragraphs[0]!.text).toBe(action.endsWith("clear") ? "" : replacement);
  expect(reopened.paragraphs[1]!.text).toBe("Unselected é海");
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
  expect(memory.readFileSync("/destination", "utf8")).toBe("Original retained destination");
});

for (const dialect of ["strict", "transitional"] as const) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["store", "deflate"] as const) for (const defect of ["alternate", "linked", "foreign", "duplicate", "mime", "bytes"] as const)
for (const path of ["model", "direct"] as const) for (const action of ["run-text", "run-clear", "paragraph-text", "paragraph-clear"] as const)
it.concurrent(`refuses ${defect} raster destruction atomically; ${dialect}; ${kind}; ${codec}; ${path}; ${action}`, async () => {
  const baseline = await fixture(dialect, kind, variants.find(v => !v.inactive && !v.floating && v.raster === rasterPng && v.codec === codec)!);
  const parts = readPackage(baseline), root = api.parseDocumentXml(parts.get("word/document.xml")!).root;
  const run = root.children[0]!.children[0]!.children.find(n => n.localName === "r")!, drawing = run.children.find(n => n.localName === "drawing")!;
  const editor = new api.DocumentXmlEditor(parts.get("word/document.xml")!), ownedRun = editor.root.children[0]!.children[0]!.children.find(n => n.localName === "r")!, ownedDrawing = ownedRun.children.find(n => n.localName === "drawing")!;
  const original = editor.sourceXml(ownedDrawing), ns = drawing.namespace.includes("purl.oclc.org") ? api.documentDialects.strict : api.documentDialects.transitional;
  let replacement = original;
  if (defect === "alternate") replacement = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:xr="urn:original-ununderstood-raster"><mc:Choice Requires="xr"><xr:unused/></mc:Choice><mc:Fallback>${original}</mc:Fallback></mc:AlternateContent>`;
  if (defect === "linked") {
    replacement = original.replace('ri:embed="', 'ri:link="rIdOriginalExternal" ri:embed="');
    const rel = new TextDecoder().decode(parts.get("word/_rels/document.xml.rels")!);
    parts.set("word/_rels/document.xml.rels", new TextEncoder().encode(rel.replace('</Relationships>', `<Relationship Id="rIdOriginalExternal" Type="${ns.r}/image" Target="https://example.invalid/never-acquire.png" TargetMode="External"/></Relationships>`)));
  }
  if (defect === "foreign") replacement = original.replace('<pic:pic>', '<pic:pic><xr:unknown xmlns:xr="urn:original-ununderstood-raster" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="xr"/>');
  if (defect === "duplicate") replacement = original.replace('<di:stretch>', '<di:blip xmlns:di="'+ns.a+'" xmlns:ri="'+ns.r+'" ri:embed="rId2"/><di:stretch>');
  if (defect === "mime") {
    const types = new TextDecoder().decode(parts.get("[Content_Types].xml")!);
    parts.set("[Content_Types].xml", new TextEncoder().encode(types.split('ContentType="image/png"').join('ContentType="image/jpeg"')));
  }
  if (defect === "bytes") for (const name of parts.keys()) if (name.endsWith(".png")) parts.set(name, Uint8Array.of(1, 2, 3));
  // This is original fixture authoring, not an edit through the protected public model.
  parts.set("word/document.xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("word/document.xml")!).replace(original, replacement)));
  const memory = Volume.fromJSON({ "/input": "", "/output": "Retained stdout", "/saved": "", "/destination": "Retained destination" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: codec }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (path === "model") {
    const document = await api.Document(input, textContext), p = document.paragraphs[0]!, r = p.runs[0]!;
    expect(() => { if (action === "run-text") r.text = "Refused"; else if (action === "run-clear") r.clear(); else if (action === "paragraph-text") p.text = "Refused"; else p.clear(); }).toThrow(api.UnsupportedEditError);
    expect(document.part.blob).toEqual(parts.get("word/document.xml"));
  } else {
    const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
    if (action.startsWith("run")) await expect(api.formatDocumentRuns(input, { paragraph: 1, run: 1, text: action.endsWith("clear") ? "" : "Refused", output: "-" }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
    else await expect(api.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { paragraph: 1, text: action.endsWith("clear") ? "" : "Refused", output: "-" } }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
  }
  expect(memory.readFileSync("/output", "utf8")).toBe("Retained stdout");
  expect(memory.readFileSync("/destination", "utf8")).toBe("Retained destination");
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
