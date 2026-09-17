import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, DocumentXmlEditor, readArchive, writeArchive, inspectDocumentComments, inspectDocumentNotes, editDocumentComments, editDocumentNotes, insertDocumentImage, createDocxInspectionCommandEngine } from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

type Kind = "comments" | "notes";
const variants = ["canonical", "main", "part", "all"] as const;
async function fixture(kind: Kind, variant: typeof variants[number], strict: boolean) {
  const body = kind === "comments" ? '<w:p><w:commentRangeStart w:id="4"/><w:r><w:t>Anchor</w:t></w:r><w:commentRangeEnd w:id="4"/><w:r><w:commentReference w:id="4"/></w:r></w:p>' : '<w:p><w:r><w:t>Anchor</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>';
  const name = kind === "comments" ? "comments" : "footnotes";
  const xml = kind === "comments" ? `<w:comments xmlns:w="${w}"><w:comment w:id="4" w:author="Original"><w:p><w:r><w:t>Original note</w:t></w:r></w:p></w:comment></w:comments>` : `<w:footnotes xmlns:w="${w}"><w:footnote w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="0" w:type="continuationSeparator"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>Original note</w:t></w:r></w:p></w:footnote></w:footnotes>`;
  const input = await textFixture(body, { [name]: { kind: name, xml } }, strict), archive = await readArchive(input, textContext);
  const member = archive.members.find(member => member.name === "[Content_Types].xml")!, editor = new DocumentXmlEditor(member.bytes);
  for (const declaration of editor.root.children) {
    const path = declaration.attributes.find(attribute => attribute.localName === "PartName")?.value;
    if ((variant === "all" || variant === "main") && path === "/word/document.xml" || (variant === "all" || variant === "part") && path === `/word/${name}.xml`) {
      const type = declaration.attributes.find(attribute => attribute.localName === "ContentType")!.value;
      editor.setAttribute(declaration, "ContentType", type.toUpperCase());
    }
  }
  const volume = Volume.fromJSON({ "/input": "" });
  await writeArchive({ ...archive, members: archive.members.map(part => part === member ? { ...part, bytes: editor.serialize() } : part) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(volume.readFileSync("/input") as Buffer);
}

for (const strict of [false, true]) for (const kind of ["comments", "notes"] as const) for (const variant of variants) for (const route of ["sdk", "cli"] as const) for (const action of ["read", "edit"] as const) it(
  `${kind} ${action} via ${route} with ${variant} XML MIME; strict=${strict}`, async () => {
    const input = await fixture(kind, variant, strict), volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
    const stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
    let items: readonly { readonly text: string }[] | undefined;
    if (route === "sdk") {
      if (action === "read") items = kind === "comments" ? (await inspectDocumentComments(input, { operation: "comments.list", options: {} }, textContext)).items : (await inspectDocumentNotes(input, { operation: "notes.list", options: {} }, textContext)).items;
      else {
        const context = { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout };
        const result = kind === "comments" ? await editDocumentComments(input, { operation: "comments.set", options: { comment: 1, text: "Updated note", output: "-" } }, context) : await editDocumentNotes(input, { operation: "notes.set", options: { note: 1, text: "Updated note", output: "-" } }, context);
        expect(result.changed).toBe(true);
        expect(result.changes).toHaveLength(1);
      }
    } else {
      const args = action === "read" ? [kind, "list", "/input", "--json"] : [kind, "set", "/input", kind === "comments" ? "--comment" : "--note", "1", "--text", "Updated note", "--output", "-"];
      const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: args.map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
        filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout,
        stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
      if (action === "read") {
        const envelope = JSON.parse(volume.readFileSync("/out", "utf8") as string);
        expect(envelope.affected).toBe(0);
        expect(envelope.errors).toEqual([]);
        items = envelope.data.items;
      }
    }
    if (action === "read") expect(items?.map(item => item.text)).toEqual(["Original note"]);
    else {
      const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
      expect([...after.keys()]).toEqual([...before.keys()]);
      const changed = kind === "comments" ? "word/comments.xml" : "word/footnotes.xml";
      for (const [name, bytes] of before) if (name !== changed) expect(after.get(name), name).toEqual(bytes);
      expect(new TextDecoder().decode(after.get(changed)!)).toContain("Updated note");
      const reread = kind === "comments" ? await inspectDocumentComments(output, { operation: "comments.list", options: {} }, textContext) : await inspectDocumentNotes(output, { operation: "notes.list", options: {} }, textContext);
      expect(reread.items.map(item => item.text)).toEqual(["Updated note"]);
      expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Anchor");
    }
    expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  }
);

for (const strict of [false, true]) it.each(variants)(`model reads comments with %s XML MIME; strict=${strict}`, async variant => {
  const input = await fixture("comments", variant, strict), doc = await Document(input, textContext);
  expect(doc.comments.length).toBe(1);
  expect(doc.comments.get(4)?.text).toBe("Original note");
  const volume = Volume.fromJSON({ "/out": "" });
  await doc.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
  expect(readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
});

for (const strict of [false, true]) for (const uppercase of [false, true]) for (const route of ["model", "sdk", "cli"] as const) it(
  `reserves existing drawing IDs via ${route}; uppercase XML MIME=${uppercase}; strict=${strict}`, async () => {
    const original = rasterPng(10, 20), added = rasterPng(20, 10), volume = Volume.fromJSON({ "/seed": "", "/input": "", "/out": "", "/err": "", "/image.png": Buffer.from(added) });
    const doc = await Document(await textFixture("<w:p/>", {}, strict), textContext);
    await doc.add_picture(original);
    await doc.save({ async write(bytes) { volume.appendFileSync("/seed", bytes); } });
    const archive = await readArchive(new Uint8Array(volume.readFileSync("/seed") as Buffer), textContext), types = archive.members.find(member => member.name === "[Content_Types].xml")!, editor = new DocumentXmlEditor(types.bytes);
    if (uppercase) {
      const declaration = editor.root.children.find(node => node.attributes.some(attribute => attribute.localName === "PartName" && attribute.value === "/word/document.xml"))!;
      editor.setAttribute(declaration, "ContentType", declaration.attributes.find(attribute => attribute.localName === "ContentType")!.value.toUpperCase());
    }
    await writeArchive({ ...archive, members: archive.members.map(member => member === types ? { ...member, bytes: editor.serialize() } : member) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
    const input = new Uint8Array(volume.readFileSync("/input") as Buffer), stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
    if (route === "model") {
      const loaded = await Document(input, textContext);
      await loaded.add_picture(added);
      await loaded.save(stdout);
    } else if (route === "sdk") {
      const result = await insertDocumentImage(input, { operation: "images.add", options: { paragraph: 2, file: { kind: "bytes", base64: Buffer.from(added).toString("base64") }, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout });
      expect(result.changed).toBe(true);
      expect(result.changes).toHaveLength(1);
    } else {
      const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: ["images", "add", "/input", "--paragraph", "2", "--file", "/image.png", "--output", "-"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
        filesystem: {
          async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); },
          readStream(path) { return { async *[Symbol.asyncIterator]() { yield new Uint8Array(volume.readFileSync(path) as Buffer); } }; }
        }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout,
        stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
    }
    const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
    for (const [name, bytes] of before) if (!["word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
    const ids: string[] = [], wp = strict ? "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing" : "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
    function collect(node: ReturnType<typeof xmlStructure>) {
      if (node.name === `{${wp}}docPr`) ids.push(node.attributes["{}id"]!);
      for (const child of node.children) if (typeof child !== "string") collect(child);
    }
    collect(xmlStructure(after.get("word/document.xml")!));
    expect(ids).toEqual(["1", "2"]);
    const mainType = xmlStructure(after.get("[Content_Types].xml")!).children.flatMap(node => typeof node === "string" ? [] : node.children).find(node => typeof node !== "string" && node.attributes["{}PartName"] === "/word/document.xml");
    expect(typeof mainType === "object" && mainType.attributes["{}ContentType"]).toBe(uppercase ? "APPLICATION/VND.OPENXMLFORMATS-OFFICEDOCUMENT.WORDPROCESSINGML.DOCUMENT.MAIN+XML" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
    const reopened = await Document(output, textContext);
    expect(reopened.inline_shapes.length).toBe(2);
    expect([...after.values()].some(bytes => Buffer.from(bytes).equals(Buffer.from(added)))).toBe(true);
    expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  }
);
