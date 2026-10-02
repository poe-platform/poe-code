import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, Inches, createDocxInspectionCommandEngine, insertDocumentImage, replaceDocumentImage, setDocumentImageLayout, writeArchive } from "./index.js";
import { replacementPng } from "../tests/fixtures/image-replacement.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

type Node = ReturnType<typeof xmlStructure>;
const nodes = (node: Node): Node[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : nodes(child))];
const encode = (text: string) => new TextEncoder().encode(text);
async function fixture(strict: boolean, kind: "docx" | "dotx", encoded: boolean) {
  const ns = strict ? { w: "http://purl.oclc.org/ooxml/wordprocessingml/main", r: "http://purl.oclc.org/ooxml/officeDocument/relationships", a: "http://purl.oclc.org/ooxml/drawingml/main", wp: "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing", pic: "http://purl.oclc.org/ooxml/drawingml/picture" }
    : { w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships", a: "http://schemas.openxmlformats.org/drawingml/2006/main", wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", pic: "http://schemas.openxmlformats.org/drawingml/2006/picture" };
  const dir = encoded ? "r%C3%A9cords" : "récords", base = encoded ? "c%C3%B4te.xml" : "côte.xml", head = encoded ? "t%C3%AAte.xml" : "tête.xml";
  const main = dir + "/" + base, header = dir + "/" + head, media = dir + "/media/" + (encoded ? "partag%C3%A9.png" : "partagé.png");
  const relName = (name: string) => name.slice(0, name.lastIndexOf("/") + 1) + "_rels/" + name.slice(name.lastIndexOf("/") + 1) + ".rels";
  const drawing = (id: number) => '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="1828800" cy="914400"/><wp:docPr id="' + id + '" name="Stored ' + id + '" descr="Original alt"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="' + ns.pic + '"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Original image"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="picture"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const declarations = Object.entries(ns).map(([prefix, uri]) => 'xmlns:' + prefix + '="' + uri + '"').join(" ") + ' xmlns:f="urn:original:opaque" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"';
  const opaque = '<f:retained><!--opaque ID is reserved--><wp:docPr id="5" name="Opaque"/></f:retained>';
  const paragraph = (start: number) => '<w:p><w:r><w:t>Original</w:t></w:r>' + drawing(start) + drawing(start + 1) + '</w:p><!--retained--><?audit original?>' + opaque;
  const edge = (id: string, role: string, target: string) => '<Relationship Id="' + id + '" Type="' + ns.r + '/' + role + '" Target="' + target + '"/>';
  const rels = (xml: string) => '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + xml + '</Relationships>';
  const type = (name: string, mime: string) => '<Override PartName="/' + name + '" ContentType="' + mime + '"/>';
  const members = new Map<string, Uint8Array>(Object.entries({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + type(main, "application/vnd.openxmlformats-officedocument.wordprocessingml." + (kind === "docx" ? "document" : "template") + ".main+xml") + type(header, "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml") + type(media, "image/png") + type(dir + "/media/image-1.png", "image/png") + type(dir + "/media/image1.png", "image/png") + '</Types>',
    "_rels/.rels": rels(edge("main", "officeDocument", main)),
    [main]: '<w:document ' + declarations + '><w:body>' + paragraph(1) + '<w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr></w:body></w:document>',
    [header]: '<w:hdr ' + declarations + '>' + paragraph(3) + '</w:hdr>',
    [relName(main)]: rels(edge("header", "header", head) + edge("picture", "image", media.slice(dir.length + 1))),
    [relName(header)]: rels(edge("picture", "image", media.slice(dir.length + 1))),
    "audit/exact.xml": "<audit>Retain exact bytes</audit>"
  }).map(([name, xml]) => [name, encode(xml)]));
  members.set(media, replacementPng(23));
  members.set(dir + "/media/image-1.png", replacementPng(31));
  members.set(dir + "/media/image1.png", replacementPng(47));
  const memory = Volume.fromJSON({ "/zip": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...members].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/zip", bytes); } }, { order: "input", compression: "store" }, textContext);
  return { input: new Uint8Array(memory.readFileSync("/zip") as Buffer), members, main, header, media, relName, drawing, opaque, ns };
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const encoded of [false, true]) for (const scope of ["body", "headers"] as const) for (const operation of ["add", "replace", "replace-size", "layout"] as const) for (const route of (operation === "add" || operation === "layout" && scope === "body" ? ["model", "sdk", "shell"] as const : ["sdk", "shell"] as const)) it(route + " " + operation + " preserves image graph in " + scope + "; " + kind + " strict=" + strict + " encoded=" + encoded, async () => {
  const { input, members, main, header, media, relName, drawing, opaque, ns } = await fixture(strict, kind, encoded);
  const target = scope === "body" ? main : header, relationship = relName(target), replacement = replacementPng(89);
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  if (route === "model") {
    const document = await Document(input, textContext);
    if (operation === "add") {
      const owner = scope === "body" ? document : document.sections[0]!.header;
      await owner.paragraphs[0]!.runs[0]!.add_picture(replacement, Inches(1), Inches(0.5));
    } else document.inline_shapes[0]!.width = Inches(1);
    await document.save(context.stdout);
  } else if (route === "sdk") {
    const file = { kind: "bytes" as const, base64: btoa(String.fromCharCode(...replacement)) }, common = { scope, output: "-", ...(scope === "headers" && operation === "add" ? { section: 1 } : {}) };
    const result = operation === "add" ? await insertDocumentImage(input, { operation: "images.add", options: { ...common, paragraph: 1, file, width: { value: 1, unit: "in" }, height: { value: 0.5, unit: "in" } } }, context)
      : operation === "layout" ? await setDocumentImageLayout(input, { operation: "images.set", options: { ...common, image: 1, width: { value: 1, unit: "in" } } }, context)
      : await replaceDocumentImage(input, { operation: "images.replace", options: { ...common, image: 1, file, ...(operation === "replace-size" ? { width: { value: 1, unit: "in" } as const, height: { value: 0.5, unit: "in" } as const, fit: "stretch" as const } : {}) } }, context);
    expect(result.changed).toBe(true); expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.after.value.part).toBe("/" + decodeURI(target));
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/new.png", replacement);
    const command = operation === "add" ? "images add --paragraph 1 --file /new.png --width 1in --height 0.5in" : operation === "layout" ? "images set --image 1 --width 1in" : "images replace --image 1 --file /new.png " + (operation === "replace-size" ? "--width 1in --height 0.5in --fit stretch" : "");
    const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })).exec("docx " + command + " /input --scope " + scope + (scope === "headers" && operation === "add" ? " --section 1" : "") + " --output - > /output");
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe("");
    memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), parts = readPackage(output);
  for (const [name, bytes] of members) if (name !== target && (operation === "layout" || ![relationship, "[Content_Types].xml"].includes(name))) expect(parts.get(name), name).toEqual(bytes);
  expect(parts.get(media)).toEqual(members.get(media));
  expect([...parts.keys()].filter(name => members.has(name))).toEqual([...members.keys()]);
  const xml = new TextDecoder().decode(parts.get(target));
  expect(xml).toContain(opaque); expect(xml).toContain("<!--retained--><?audit original?>"); expect(xml).toContain(drawing(scope === "body" ? 2 : 4));
  if (operation === "add") expect(xml).toContain(drawing(scope === "body" ? 1 : 3));
  const tree = nodes(xmlStructure(parts.get(target)!)), drawings = tree.filter(node => node.name === "{" + ns.wp + "}inline");
  expect(drawings).toHaveLength(operation === "add" ? 3 : 2);
  const changed = operation === "add" ? route === "model" ? drawings[0]! : drawings[2]! : drawings[0]!;
  const extent = nodes(changed).find(node => node.name === "{" + ns.wp + "}extent")!;
  expect(extent.attributes["{}cx"]).toBe(operation === "replace" ? "1828800" : "914400");
  expect(extent.attributes["{}cy"]).toBe(operation === "replace" || route === "model" && operation === "layout" ? "914400" : "457200");
  const edges = nodes(xmlStructure(parts.get(relationship)!)).filter(node => node.name.endsWith("}Relationship"));
  const previous = nodes(xmlStructure(members.get(relationship)!)).filter(node => node.name.endsWith("}Relationship"));
  for (const edge of previous) expect(edges).toContainEqual(edge);
  const blip = nodes(changed).find(node => node.name === "{" + ns.a + "}blip")!;
  const edge = edges.find(node => node.attributes["{}Id"] === blip.attributes["{" + ns.r + "}embed"])!;
  const resolved = decodeURI(new URL(edge.attributes["{}Target"]!, "https://package.invalid/" + target).pathname.slice(1));
  const resource = [...parts].find(([name]) => decodeURI(name) === resolved)!;
  expect(resource[1]).toEqual(operation === "layout" ? members.get(media) : replacement);
  if (operation === "add") expect(Number(nodes(changed).find(node => node.name === "{" + ns.wp + "}docPr")!.attributes["{}id"])).toBeGreaterThan(5);
  const reopened = await Document(output, textContext);
  expect(String(reopened.part.partname)).toBe("/récords/côte.xml");
  expect(reopened.inline_shapes).toHaveLength(scope === "body" && operation === "add" ? 3 : 2);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const encoded of [false, true]) for (const scope of ["body", "headers"] as const) for (const route of ["sdk", "shell"] as const) for (const mode of ["shared", "unchanged"] as const) it(`${route} ${mode} image update retains canonical graph; ${scope} ${kind} strict=${strict} encoded=${encoded}`, async () => {
  const { input, members, main, header, media, relName, opaque, ns } = await fixture(strict, kind, encoded);
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" }), replacement = replacementPng(89);
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  if (route === "sdk") {
    const common = { scope, image: 1, output: "-" };
    const file = { kind: "bytes" as const, base64: btoa(String.fromCharCode(...replacement)) };
    const result = mode === "shared" ? await replaceDocumentImage(input, { operation: "images.replace", options: { ...common, shared: true, file } }, context)
      : await setDocumentImageLayout(input, { operation: "images.set", options: { ...common, width: { value: 2, unit: "in" } } }, context);
    expect(result.changed).toBe(mode === "shared"); expect(result.changes).toHaveLength(mode === "shared" ? 4 : 0);
    if (mode === "shared") {
      const staged = new Uint8Array(memory.readFileSync("/output") as Buffer); memory.writeFileSync("/output", "");
      const layout = await setDocumentImageLayout(staged, { operation: "images.set", options: { scope: "all-stories", all: true, width: { value: 1, unit: "in" }, output: "-" } }, context);
      expect(layout.changes).toHaveLength(4);
    }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/new.png", replacement);
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    const command = mode === "shared" ? "images replace --shared --file /new.png" : "images set --width 2in";
    const result = await shell.exec(`docx ${command} /input --image 1 --scope ${scope} --output - > /output`);
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe("");
    if (mode === "shared") {
      await fs.writeFile("/shared", await fs.readFile("/output"));
      const layout = await shell.exec("docx images set /shared --all --scope all-stories --width 1in --output - > /output");
      expect(layout.exitCode, layout.stderr).toBe(0); expect(layout.stdout).toBe("");
    }
    memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), parts = readPackage(output);
  if (mode === "unchanged") {
    expect([...parts.keys()]).toEqual([...members.keys()]);
    for (const [name, bytes] of members) expect(parts.get(name), name).toEqual(bytes);
  } else {
    const dirty = new Set([main, header, relName(main), relName(header), "[Content_Types].xml", media]);
    for (const [name, bytes] of members) if (!dirty.has(name) || name === media && parts.has(name)) expect(parts.get(name), name).toEqual(bytes);
    for (const owner of [main, header]) {
      const xml = new TextDecoder().decode(parts.get(owner));
      expect(xml).toContain(opaque); expect(xml).toContain("<!--retained--><?audit original?>");
      const tree = nodes(xmlStructure(parts.get(owner)!)), frames = tree.filter(n => n.name === `{${ns.wp}}inline`);
      expect(frames).toHaveLength(2);
      for (const frame of frames) {
        const extent = nodes(frame).find(n => n.name === `{${ns.wp}}extent`)!;
        expect(extent.attributes["{}cx"]).toBe("914400"); expect(extent.attributes["{}cy"]).toBe("457200");
        expect(nodes(frame).find(n => n.name === `{${ns.wp}}docPr`)!.attributes["{}descr"]).toBe("Original alt");
      }
      const edges = nodes(xmlStructure(parts.get(relName(owner))!)).filter(n => n.name.endsWith("}Relationship"));
      const image = edges.find(n => n.attributes["{}Id"] === "picture")!;
      expect(image.attributes["{}Type"]).toBe(ns.r + "/image");
      const target = decodeURI(new URL(image.attributes["{}Target"]!, "https://package.invalid/" + owner).pathname.slice(1));
      expect([...parts].find(([name]) => decodeURI(name) === target)![1]).toEqual(replacement);
    }
    for (const override of nodes(xmlStructure(parts.get("[Content_Types].xml")!)).filter(n => n.name.endsWith("}Override"))) expect([...parts.keys()].map(name => "/" + decodeURI(name))).toContain(decodeURI(override.attributes["{}PartName"]!));
  }
  const reopened = await Document(output, textContext);
  expect(String(reopened.part.partname)).toBe("/récords/côte.xml"); expect(reopened.inline_shapes).toHaveLength(2);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
