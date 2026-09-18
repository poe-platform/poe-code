import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import { rasterPng } from "../tests/fixtures/raster.js";

const errors = api as unknown as Record<string, new (message?: string, options?: ErrorOptions) => Error>;
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const ref = (resultHandle: string) => ({ resultHandle });
const quote = (text: string) => "'" + text.split("'").join("'\\''") + "'";

function ownedFailure(action: () => unknown): void {
  let failure: unknown;
  try { action(); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ code: "conflict" });
  expect(errors.OwnershipError).toBeTypeOf("function");
  expect(failure).toBeInstanceOf(errors.OwnershipError!);
}

async function fixture(strict: boolean, kind: "docx" | "dotx", foreign = false): Promise<Uint8Array> {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  if (foreign) parts.set("_rels/.rels", encode(decode(parts.get("_rels/.rels")!).replace('Id="document"', 'Id="foreign"')));
  const volume = Volume.fromJSON({ "/archive": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/archive", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(volume.readFileSync("/archive") as Buffer);
}

it("exports ownership conflicts with standard cause semantics", () => {
  expect(errors.OwnershipError).toBeTypeOf("function");
  const cause = {};
  expect(new errors.OwnershipError!("Foreign owner", { cause })).toMatchObject({ code: "conflict", message: "Foreign owner", cause });
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["root", "main"] as const)
for (const action of ["add", "get-or-add", "load", "relate", "set", "update", "setdefault"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} rejects foreign ${owner} ${action} with ownership conflict; ${kind} strict=${strict}`, async () => {
  const input = await fixture(strict, kind), foreignInput = await fixture(!strict, kind, true);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/foreign": Buffer.from(foreignInput), "/output": "Retained sentinel" });
  if (route === "model") {
    const doc = await api.Document(input, textContext), foreign = await api.Document(foreignInput, textContext);
    const targetOwner = owner === "root" ? doc.part.package : doc.part, rels = targetOwner.rels;
    const before = rels.xml, partBefore = doc.part.blob, edge = foreign.part.package.rels.at("foreign");
    const execute = (target: api.PartView, value: api.RelationshipView) => {
      if (action === "add") rels.add_relationship("urn:original:edge", target, "foreign");
      else if (action === "get-or-add") rels.get_or_add("urn:original:edge", target);
      else if (action === "load") targetOwner.load_rel("urn:original:edge", target, "foreign");
      else if (action === "relate") targetOwner.relate_to(target, "urn:original:edge");
      else if (action === "set") rels.set("foreign", value);
      else if (action === "update") rels.update([["foreign", value]]);
      else rels.setdefault("foreign", value);
    };
    expect(() => execute({} as api.PartView, {} as api.RelationshipView)).toThrow(api.InputTypeError);
    ownedFailure(() => execute(foreign.part, edge));
    expect(rels.xml).toBe(before); expect(doc.part.blob).toEqual(partBefore);
    expect(rels.get("absent", edge)).toBe(edge); expect(rels.pop("absent", edge)).toBe(edge);
    if (owner === "root") expect(rels.setdefault("document", edge)).toBe(rels.at("document"));
  } else {
    const prefix = owner === "root" ? "model.opc.package.OpcPackage" : "model.opc.part.Part";
    const operation = action === "load" || action === "relate" ? `${prefix}.${action === "load" ? "load_rel" : "relate_to"}.call`
      : `model.opc.rel.Relationships.${{ add: "add_relationship", "get-or-add": "get_or_add", set: "__setitem__", update: "update", setdefault: "setdefault" }[action]}.call`;
    const args = action === "add" || action === "load" ? { reltype: "urn:original:edge", target: ref("foreignPart"), rId: "foreign" }
      : action === "relate" ? { reltype: "urn:original:edge", [owner === "root" ? "part" : "target"]: ref("foreignPart") }
      : action === "get-or-add" ? { reltype: "urn:original:edge", targetPart: ref("foreignPart") }
      : action === "update" ? { entries: [["foreign", ref("foreignEdge")]] }
      : { rId: "foreign", value: ref("foreignEdge") };
    const batch = { version: 1 as const, operations: [
      { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
      { operation: "model.opc.part.Part.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" },
      { operation: `${prefix}.rels.get`, receiver: ref(owner === "root" ? "package" : "main"), arguments: {}, resultHandle: "rels" },
      { operation: "model.package.Package.open.call", arguments: { pkgFile: { path: "/foreign", capability: "command" }, context: { vfs: "command" } }, resultHandle: "foreignPackage" },
      { operation: "model.package.Package.main_document_part.get", receiver: ref("foreignPackage"), arguments: {}, resultHandle: "foreignPart" },
      { operation: "model.opc.package.OpcPackage.rels.get", receiver: ref("foreignPackage"), arguments: {}, resultHandle: "foreignRels" },
      { operation: "model.opc.rel.Relationships.__getitem__.call", receiver: ref("foreignRels"), arguments: { rId: "foreign" }, resultHandle: "foreignEdge" },
      { operation, receiver: ref(action === "load" || action === "relate" ? owner === "root" ? "package" : "main" : "rels"), arguments: args }
    ] };
    if (route === "sdk") {
      let failure: unknown;
      try { await api.applyStyleModelBatch(input, batch, { ...textContext, binaryResolver: { capability: "command", async *open(path) { yield new Uint8Array(volume.readFileSync(path) as Buffer); } } }); }
      catch (error) { failure = error; }
      expect(failure).toMatchObject({ code: "conflict", operationIndex: 7 });
      expect(errors.OwnershipError).toBeTypeOf("function"); expect(failure).toBeInstanceOf(errors.OwnershipError!);
    } else {
      const fs = new MemoryFileSystem(); for (const path of ["/input", "/foreign", "/output"]) await fs.writeFile(path, new Uint8Array(volume.readFileSync(path) as Buffer));
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const result = await shell.exec("docx batch /input --ops-json " + quote(JSON.stringify(batch)) + " --output /output --force --json");
        expect(result.exitCode, result.stderr).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, affected: 0, data: null, errors: [{ code: "conflict", operationIndex: 7 }] });
        for (const path of ["/input", "/foreign", "/output"]) expect(await fs.readFile(path)).toEqual(new Uint8Array(volume.readFileSync(path) as Buffer));
      } finally { await shell.dispose(); }
    }
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input)); expect(volume.readFileSync("/foreign")).toEqual(Buffer.from(foreignInput)); expect(volume.readFileSync("/output", "utf8")).toBe("Retained sentinel");
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
it(`distinguishes foreign images and style values from wrong input types; ${kind} strict=${strict}`, async () => {
  const doc = await api.Document(await fixture(strict, kind), textContext), foreign = await api.Document(await fixture(!strict, kind), textContext);
  const image = await foreign.part.package.image_parts.get_or_add_image_part(rasterPng());
  expect(() => doc.part.package.image_parts.append({} as api.ImagePartView)).toThrow(api.InputTypeError);
  ownedFailure(() => doc.part.package.image_parts.append(image)); expect(doc.part.package.image_parts.length).toBe(0);
  const local = doc.styles.add_style("Local", api.WD_STYLE_TYPE.PARAGRAPH) as api.ParagraphStyle;
  const other = foreign.styles.add_style("Foreign", api.WD_STYLE_TYPE.PARAGRAPH);
  const before = doc.styles.part.blob;
  for (const apply of [(style: api.BaseStyle) => doc.styles.get_style_id(style, api.WD_STYLE_TYPE.PARAGRAPH), (style: api.BaseStyle) => { local.base_style = style; }, (style: api.BaseStyle) => { local.next_paragraph_style = style; }]) {
    expect(() => apply({} as api.BaseStyle)).toThrow(TypeError); ownedFailure(() => apply(other)); expect(doc.styles.part.blob).toEqual(before);
  }
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const action of ["get-id", "base", "next"] as const) for (const invalid of [false, true])
it(`classifies style ${action}, wrong-type=${invalid}; ${kind} strict=${strict}`, async () => {
  const doc = await api.Document(await fixture(strict, kind), textContext), foreign = await api.Document(await fixture(!strict, kind), textContext);
  const local = doc.styles.add_style("Local", api.WD_STYLE_TYPE.PARAGRAPH) as api.ParagraphStyle;
  const other = foreign.styles.add_style("Foreign", api.WD_STYLE_TYPE.PARAGRAPH), before = doc.styles.part.blob;
  const value = invalid ? {} as api.BaseStyle : other;
  const run = () => { if (action === "get-id") return doc.styles.get_style_id(value, api.WD_STYLE_TYPE.PARAGRAPH); if (action === "base") local.base_style = value; else local.next_paragraph_style = value; };
  if (invalid) expect(run).toThrow(api.InputTypeError); else ownedFailure(run);
  expect(doc.styles.part.blob).toEqual(before);
});

it("retains XML wrong-type, local scope and opaque edit boundaries", () => {
  const local = new api.DocumentXmlEditor(encode('<root><parent><child/></parent><sibling/></root>'));
  expect(() => local.sourceXml({} as api.XmlElement)).toThrow(api.InputTypeError);
  expect(() => local.insertChildren(local.root.children[0]!, "<new/>", local.root.children[1]!)).toThrow(api.UnsupportedEditError);
  expect(() => local.replaceElement(local.root, "<new/>")).toThrow(api.UnsupportedEditError);
  expect(() => local.setText(local.root, "new")).toThrow(api.UnsupportedEditError);
  expect(local.dirtyNodes).toEqual([]);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const action of ["style-id", "base", "next", "image"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} rejects foreign ${action} handles without publication; ${kind} strict=${strict}`, async () => {
  const input = await fixture(strict, kind), foreign = await fixture(!strict, kind);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/foreign": Buffer.from(foreign), "/output": "Retained sentinel" });
  const operations: api.DocxBatchOperation[] = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.opc.part.Part.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" },
    { operation: "model.package.Package.open.call", arguments: { pkgFile: { path: "/foreign", capability: "command" }, context: { vfs: "command" } }, resultHandle: "foreignPackage" }
  ];
  if (action === "image") operations.push(
    { operation: "model.package.Package.image_parts.get", receiver: ref("package"), arguments: {}, resultHandle: "images" },
    { operation: "model.package.Package.get_or_add_image_part.call", receiver: ref("foreignPackage"), arguments: { imageDescriptor: { kind: "bytes", base64: Buffer.from(rasterPng()).toString("base64") } }, resultHandle: "foreignImage" },
    { operation: "model.package.ImageParts.append.call", receiver: ref("images"), arguments: { item: ref("foreignImage") } }
  );
  else operations.push(
    { operation: "model.package.Package.main_document_part.get", receiver: ref("foreignPackage"), arguments: {}, resultHandle: "foreignPart" },
    { operation: "model.parts.document.DocumentPart.document.get", receiver: ref("foreignPart"), arguments: {}, resultHandle: "foreignDocument" },
    { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" },
    { operation: "model.document.Document.styles.get", receiver: ref("foreignDocument"), arguments: {}, resultHandle: "foreignStyles" },
    { operation: "model.styles.styles.Styles.add_style.call", receiver: ref("styles"), arguments: { name: "Local", styleType: api.WD_STYLE_TYPE.PARAGRAPH }, resultHandle: "localStyle" },
    { operation: "model.styles.styles.Styles.add_style.call", receiver: ref("foreignStyles"), arguments: { name: "Foreign", styleType: api.WD_STYLE_TYPE.PARAGRAPH }, resultHandle: "foreignStyle" },
    action === "style-id" ? { operation: "model.styles.styles.Styles.get_style_id.call", receiver: ref("styles"), arguments: { styleOrName: ref("foreignStyle"), styleType: api.WD_STYLE_TYPE.PARAGRAPH } }
      : { operation: `model.styles.style.ParagraphStyle.${action === "base" ? "base_style" : "next_paragraph_style"}.set`, receiver: ref("localStyle"), arguments: { value: ref("foreignStyle") } }
  );
  const batch = { version: 1 as const, operations }, operationIndex = operations.length - 1;
  if (route === "sdk") await expect(api.applyStyleModelBatch(input, batch, { ...textContext, binaryResolver: { capability: "command", async *open(path) { yield new Uint8Array(volume.readFileSync(path) as Buffer); } } })).rejects.toMatchObject({ code: "conflict", name: "OwnershipError", operationIndex });
  else {
    const fs = new MemoryFileSystem(); for (const path of ["/input", "/foreign", "/output"]) await fs.writeFile(path, new Uint8Array(volume.readFileSync(path) as Buffer));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-json " + quote(JSON.stringify(batch)) + " --output /output --force --json");
      expect(result.exitCode, result.stderr).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "conflict", operationIndex }] });
      for (const path of ["/input", "/foreign", "/output"]) expect(await fs.readFile(path)).toEqual(new Uint8Array(volume.readFileSync(path) as Buffer));
    } finally { await shell.dispose(); }
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input)); expect(volume.readFileSync("/foreign")).toEqual(Buffer.from(foreign)); expect(volume.readFileSync("/output", "utf8")).toBe("Retained sentinel");
});

for (const operation of ["shape-guard", "equation-replace", "equation-append", "source", "source-replacement", "replace", "scalar", "insert-parent", "insert-before", "text", "attribute", "leading", "tail", "qualified"] as const)
it(`classifies foreign XML ${operation} ownership without dirtying either editor`, () => {
  const bytes = encode('<root><leaf a="original">Original</leaf></root>'), local = new api.DocumentXmlEditor(bytes), foreign = new api.DocumentXmlEditor(bytes);
  const element = foreign.root.children[0]!;
  ownedFailure(() => {
    if (operation === "shape-guard") local.assertShapeEditAllowed(element);
    else if (operation === "equation-replace") local.replaceEquationElement(element, "<leaf/>");
    else if (operation === "equation-append") local.appendEquationElement(element, "<leaf/>");
    else if (operation === "source") local.sourceXml(element);
    else if (operation === "source-replacement") local.sourceXml(local.root, new Map([[element, "<leaf/>"]]));
    else if (operation === "replace") local.replaceElement(element, "<leaf/>");
    else if (operation === "scalar") local.replaceScalarText(element, "Changed");
    else if (operation === "insert-parent") local.insertChildren(element, "<leaf/>");
    else if (operation === "insert-before") local.insertChildren(local.root, "<leaf/>", element);
    else if (operation === "text") local.setText(element.content[0]!, "Changed");
    else if (operation === "attribute") local.setAttribute(element, "a", "Changed");
    else if (operation === "leading") local.setLeadingText(element, "Changed");
    else if (operation === "tail") local.setElementTail(element, "Changed");
    else local.setQualifiedAttribute(element, { namespace: "", localName: "a" }, "Changed");
  });
  expect(local.dirtyNodes).toEqual([]); expect(foreign.dirtyNodes).toEqual([]); expect(local.serialize()).toEqual(bytes); expect(foreign.serialize()).toEqual(bytes);
});
