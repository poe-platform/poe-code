import { Volume } from "memfs";
import { expect, it } from "vitest";
import { DocumentXmlEditor } from "./xml-write.js";
import { Document, createDocxInspectionCommandEngine, executeDocumentBatch, writeArchive, type XmlElementView } from "./index.js";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { svgPairFixture, svgContext } from "../tests/fixtures/svg-image.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const carrier of ["direct", "choice", "process"] as const)
for (const descendant of [false, true])
it(`retains paired-image attribute restrictions through ${carrier}; descendant=${descendant} strict=${strict}`, () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const a = strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const image = '<a:blip r:embed="primary"><a:extLst><a:ext uri="urn:original:opaque"><f:image r:embed="alternate"/></a:ext></a:extLst></a:blip>';
  const body = carrier === "direct" ? image : carrier === "choice" ? `<mc:AlternateContent><mc:Choice Requires="a">${image}</mc:Choice><mc:Fallback/></mc:AlternateContent>` : `<f:pass mc:Ignorable="f" mc:ProcessContent="f:pass">${image}</f:pass>`;
  const xml = `<w:document xmlns:w="${w}" xmlns:a="${a}" xmlns:r="${r}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:opaque"><w:body><w:p><w:r><w:drawing>${body}</w:drawing></w:r></w:p></w:body></w:document>`;
  const volume = Volume.fromJSON({"/input": xml}), input = new Uint8Array(volume.readFileSync("/input") as Buffer);
  const editor = new DocumentXmlEditor(input);
  const drawing = editor.root.children[0]!.children[0]!.children[0]!.children[0]!;
  const blip = carrier === "direct" ? drawing.children[0]! : carrier === "choice" ? drawing.children[0]!.children[0]!.children[0]! : drawing.children[0]!.children[0]!;
  const target = descendant ? blip.children[0]! : blip;
  expect(() => editor.setQualifiedAttribute(target, {namespace: r, localName: "embed"}, "changed")).toThrowError();
  expect(editor.serialize()).toEqual(input);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "process"] as const)
for (const route of ["model", "sdk", "shell"] as const)
for (const descendant of [false, true])
it(`${route} refuses paired SVG representation attribute changes without publication; ${carrier} ${kind} descendant=${descendant} strict=${strict}`, async () => {
  const enc = (value: string) => new TextEncoder().encode(value);
  const a = strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const parts = readPackage(await svgPairFixture(strict));
  const main = new TextDecoder().decode(parts.get("word/document.xml")!);
  const start = main.indexOf("<di:blip "), end = main.indexOf("</di:blip>") + "</di:blip>".length;
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  const blip = main.slice(start, end), mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
  const wrapped = carrier === "direct" ? blip : carrier === "choice" ? `<mc:AlternateContent xmlns:mc="${mc}" xmlns:a="${a}"><mc:Choice Requires="a">${blip}</mc:Choice><mc:Fallback/></mc:AlternateContent>` : `<f:pass xmlns:f="urn:original:future" xmlns:mc="${mc}" mc:Ignorable="f" mc:ProcessContent="f:pass">${blip}</f:pass>`;
  parts.set("word/document.xml", enc(main.slice(0, start) + wrapped + main.slice(end)));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, svgContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), model = await Document(input, svgContext);
  const pending: { view: XmlElementView; path: number[] }[] = [{ view: model.element, path: [] }];
  let found: { view: XmlElementView; path: number[] } | undefined;
  while (pending.length) {
    const item = pending.pop()!;
    if (item.view.namespace === a && item.view.localName === (descendant ? "extLst" : "blip")) { found = item; break; }
    item.view.children.forEach((view, index) => pending.push({ view, path: [...item.path, index] }));
  }
  expect(found).toBeDefined();
  const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
  const operations: { operation: string; receiver: ReturnType<typeof ref>; arguments: Record<string, unknown>; resultHandle?: string }[] = [{ operation: "model.document.Document.element.get", receiver: ref("document"), arguments: {}, resultHandle: "root" }];
  let receiver = ref("root");
  for (const [depth, index] of found!.path.entries()) {
    operations.push({ operation: "model.XmlElementView.children.get", receiver, arguments: {}, resultHandle: `children${depth}` }); receiver = ref(`children${depth}`, index);
  }
  const name = { namespaceURI: "", localName: "audit" };
  operations.push({ operation: "model.XmlElementView.set_attribute.call", receiver, arguments: { name, value: "changed" } });
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    expect(() => found!.view.set_attribute(name, "changed")).toThrowError();
    await model.save(sink);
    expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(parts);
  } else if (route === "sdk") {
    await expect(executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...svgContext, stdout: sink })).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(memory.readFileSync("/output")).toHaveLength(0);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", enc("sentinel")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: svgContext.limits }) })).exec("docx batch /input --ops-file /ops --output /output --force --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] });
    expect(await fs.readFile("/output")).toEqual(enc("sentinel")); expect(await fs.readFile("/input")).toEqual(input);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
