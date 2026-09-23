import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w, r } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const stamp = new Date("2026-04-05T06:07:08Z"), context = { ...textContext, timestamp: stamp };
const image = rasterPng(), binary = { kind: "bytes", base64: Buffer.from(image).toString("base64") };
const encode = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (let row = 1618; row <= 1630; row++) for (const route of ["model", "sdk", "cli"] as const)
it(`complete expanded rich-comment workflow R${row}; strict=${strict}; kind=${kind}; route=${route}`, async () => {
  const empty = row <= 1619, defaultComment = row >= 1620 && row <= 1622, picture = row === 1630;
  const id = defaultComment ? 0 : 17;
  const drawingNs = strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const pictureNs = strict ? "http://purl.oclc.org/ooxml/drawingml/picture" : "http://schemas.openxmlformats.org/drawingml/2006/picture";
  const wp = strict ? "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing" : "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
  const drawing = `<w:r><w:drawing><wp:inline xmlns:wp="${wp}"><wp:extent cx="914400" cy="914400"/><wp:docPr id="13" name="Original evidence"/><a:graphic xmlns:a="${drawingNs}"><a:graphicData uri="${pictureNs}"><pic:pic xmlns:pic="${pictureNs}"><pic:nvPicPr><pic:cNvPr id="13" name="evidence.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="originalImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  const comments = `<w:comments xmlns:w="${w}" xmlns:r="${r}"><!--comments retained-->${empty ? "" : `<w:comment w:id="${id}" w:author="Archive author" w:initials="AA" w:date="2026-04-05T06:07:08Z"><w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>${defaultComment ? "" : '<w:r><w:t>First 海🌊 é</w:t></w:r>'}${picture ? drawing : ""}</w:p></w:comment>`}<?audit exact?></w:comments>`;
  const styles = `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="Comment Text"/></w:style><w:style w:type="character" w:styleId="CommentReference"><w:name w:val="Comment Reference"/></w:style><w:style w:type="paragraph" w:styleId="MarginNote"><w:name w:val="Margin note"/></w:style><!--styles retained--><?audit exact?></w:styles>`;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Untouched 日本 עברית</w:t></w:r></w:p><w:sectPr/>', { comments: { kind: "comments", xml: comments }, styles: { kind: "styles", xml: styles } }, strict, { kind }));
  if (picture) {
    parts.set("word/media/evidence.png", image);
    parts.set("word/_rels/comments.xml.rels", encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="originalImage" Type="${strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r}/image" Target="media/evidence.png"/></Relationships>`));
    const types = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!);
    types.insertChildren(types.root, '<Default xmlns="http://schemas.openxmlformats.org/package/2006/content-types" Extension="png" ContentType="image/png"/>');
    parts.set("[Content_Types].xml", types.serialize());
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: stamp })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const operations: Record<string, unknown>[] = [], observations = new Map<string, number>();
  const add = (operation: string, receiver: ReturnType<typeof ref>, args: Record<string, unknown> = {}, handle?: string, observation?: string) => {
    if (observation) observations.set(observation, operations.length);
    operations.push({ operation, receiver, arguments: args, ...(handle ? { resultHandle: handle } : {}) });
  };
  add("model.document.Document.part.get", ref("document"), {}, "main");
  add("model.parts.document.DocumentPart.part_related_by.call", ref("main"), { reltype: (strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r) + "/comments" }, "commentsPart");
  add("model.parts.comments.CommentsPart.comments.get", ref("commentsPart"), {}, "comments");
  if (empty) {
    add("model.comments.Comments.__len__.get", ref("comments"), {}, undefined, "beforeCount");
    add("model.comments.Comments.add_comment.call", ref("comments"), row === 1619 ? { author: "Coastal reviewer", initials: "CR" } : {}, "comment");
  } else add("model.comments.Comments.get.call", ref("comments"), { commentId: id }, "comment");
  if (row === 1620) {
    add("model.document.Document.styles.get", ref("document"), {}, "styles");
    add("model.styles.styles.Styles.__getitem__.call", ref("styles"), { key: "Margin note" }, "selectedStyle");
  }
  if (row >= 1620 && row <= 1622) add("model.comments.Comment.add_paragraph.call", ref("comment"), row === 1620 ? { text: "Second 海🌊", style: ref("selectedStyle") } : {}, "addedParagraph");
  if (row === 1622) {
    add("model.text.paragraph.Paragraph.add_run.call", ref("addedParagraph"), {}, "addedRun");
    add("model.text.run.Run.add_picture.call", ref("addedRun"), { input: binary });
    add("model.text.run.Run.iter_inner_content.call", ref("addedRun"), {}, "drawings", "drawings");
  }
  if (row === 1623 || row === 1624) add(`model.comments.Comment.${row === 1623 ? "author" : "initials"}.set`, ref("comment"), { value: row === 1623 ? "Independent reviewer" : "IR" });
  add("model.comments.Comment.paragraphs.get", ref("comment"), {}, "paragraphs", "paragraphs");
  if (row === 1618) {
    add("model.comments.Comment.comment_id.get", ref("comment"), {}, undefined, "id");
    add("model.comments.Comments.__len__.get", ref("comments"), {}, undefined, "count");
    add("model.comments.Comments.get.call", ref("comments"), { commentId: 0 }, "lookedUp");
    add("model.comments.Comment.__eq__.call", ref("comment"), { other: ref("lookedUp") }, undefined, "equals");
  }
  if (row >= 1620 && row <= 1621) {
    add("model.text.paragraph.Paragraph.text.get", ref("addedParagraph"), {}, undefined, "text");
    add("model.text.paragraph.Paragraph.__eq__.call", ref("addedParagraph"), { other: ref("paragraphs", 1) }, undefined, "equals");
  }
  if (row === 1618 || row === 1620 || row === 1621) {
    add("model.text.paragraph.Paragraph.style.get", row === 1618 ? ref("paragraphs", 0) : ref("addedParagraph"), {}, "paragraphStyle");
    add("model.styles.style.BaseStyle.name.get", ref("paragraphStyle"), {}, undefined, "style");
    if (row === 1620) add("model.styles.style.BaseStyle.__eq__.call", ref("paragraphStyle"), { other: ref("selectedStyle") }, undefined, "styleEquals");
  }
  if ([1619, 1623, 1626].includes(row)) add("model.comments.Comment.author.get", ref("comment"), {}, undefined, "author");
  if ([1619, 1624, 1627].includes(row)) add("model.comments.Comment.initials.get", ref("comment"), {}, undefined, "initials");
  if (row === 1625) add("model.comments.Comment.comment_id.get", ref("comment"), {}, undefined, "id");
  if (row === 1628) add("model.comments.Comment.timestamp.get", ref("comment"), {}, undefined, "timestamp");
  if (row === 1629) add("model.text.paragraph.Paragraph.text.get", ref("paragraphs", 0), {}, undefined, "text");
  if (picture) {
    add("model.text.paragraph.Paragraph.runs.get", ref("paragraphs", 0), {}, "runs");
    add("model.text.run.Run.iter_inner_content.call", ref("runs", 2), {}, "drawings", "drawings");
  }
  if (row === 1622 || picture) {
    add("model.drawing.Drawing.has_picture.get", ref("drawings", 0), {}, undefined, "hasPicture");
    add("model.drawing.Drawing.image.get", ref("drawings", 0), {}, "image");
    add("model.image.image.Image.blob.get", ref("image"), {}, undefined, "blob");
  }
  const observe = (values: unknown[]) => {
    const value = (key: string) => values[observations.get(key)!];
    expect(value("paragraphs")).toHaveLength(row >= 1620 && row <= 1622 ? 2 : 1);
    if (empty) expect(value("beforeCount")).toBe(0);
    if (row === 1618) { expect(value("id")).toBe(0); expect(value("count")).toBe(1); expect(value("equals")).toBe(true); }
    if (row === 1618 || row === 1621) expect(value("style")).toBe("Comment Text");
    if (row === 1620) { expect(value("text")).toBe("Second 海🌊"); expect(value("style")).toBe("Margin note"); expect(value("styleEquals")).toBe(true); }
    if (row === 1621) expect(value("text")).toBe("");
    if (row === 1620 || row === 1621) expect(value("equals")).toBe(true);
    if (observations.has("author")) expect(value("author")).toBe(row === 1619 ? "Coastal reviewer" : row === 1623 ? "Independent reviewer" : "Archive author");
    if (observations.has("initials")) expect(value("initials")).toBe(row === 1619 ? "CR" : row === 1624 ? "IR" : "AA");
    if (row === 1625) expect(value("id")).toBe(17);
    if (row === 1628) expect(value("timestamp")).toBe(stamp.toISOString());
    if (row === 1629) expect(value("text")).toBe("First 海🌊 é");
    if (row === 1622 || picture) { expect(value("drawings")).toMatchObject([{ type: "Drawing" }]); expect(value("drawings")).toHaveLength(1); expect(value("hasPicture")).toBe(true); expect(value("blob")).toEqual(binary); }
  };
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const document = await api.Document(input, context), comments = document.comments;
    if (empty) expect(comments.length).toBe(0);
    const comment = empty ? row === 1619 ? comments.add_comment(undefined, "Coastal reviewer", "CR") : comments.add_comment() : comments.get(id)!;
    expect(comment).toBeInstanceOf(api.Comment);
    if (row === 1618) { expect(comment.comment_id).toBe(0); expect(comments.length).toBe(1); expect(comments.get(0)!.equals(comment)).toBe(true); }
    if (row === 1619) { expect(comment.author).toBe("Coastal reviewer"); expect(comment.initials).toBe("CR"); }
    if (row >= 1620 && row <= 1622) {
      const selectedStyle = document.styles.at("Margin note");
      if (!(selectedStyle instanceof api.ParagraphStyle)) throw new Error("Missing owned paragraph style");
      const paragraph = row === 1620 ? comment.add_paragraph("Second 海🌊", selectedStyle) : comment.add_paragraph();
      expect(comment.paragraphs).toHaveLength(2); expect(comment.paragraphs.at(-1)!.equals(paragraph)).toBe(true);
      expect(paragraph.text).toBe(row === 1620 ? "Second 海🌊" : "");
      expect(paragraph.style!.equals(row === 1620 ? selectedStyle : document.styles.at("Comment Text"))).toBe(true);
      if (row === 1622) { const run = paragraph.add_run(); await run.add_picture(image); const contents = [...run.iter_inner_content()]; expect(contents).toHaveLength(1); expect(contents[0]).toBeInstanceOf(api.Drawing); const drawing = contents[0] as api.Drawing; expect(drawing.has_picture).toBe(true); expect(drawing.image.blob).toEqual(image); }
    } else expect(comment.paragraphs).toHaveLength(1);
    if (row === 1618) expect(comment.paragraphs[0]!.style!.name).toBe("Comment Text");
    if (row === 1623) { comment.author = "Independent reviewer"; expect(comment.author).toBe("Independent reviewer"); }
    if (row === 1624) { comment.initials = "IR"; expect(comment.initials).toBe("IR"); }
    if (row === 1625) { expect(comment.comment_id).toBe(17); expect(Reflect.set(comment, "comment_id", 99)).toBe(false); expect("id" in comment).toBe(false); expect(comment.comment_id).toBe(17); }
    if (row === 1626) expect(comment.author).toBe("Archive author");
    if (row === 1627) expect(comment.initials).toBe("AA");
    if (row === 1628) { const date = comment.timestamp!; expect(date).toEqual(stamp); date.setUTCFullYear(2000); expect(comment.timestamp).toEqual(stamp); expect(Reflect.set(comment, "timestamp", new Date(0))).toBe(false); }
    if (row === 1629) expect(comment.paragraphs[0]!.text).toBe("First 海🌊 é");
    if (picture) { const contents = [...comment.paragraphs[0]!.runs[2]!.iter_inner_content()]; expect(contents).toHaveLength(1); expect(contents[0]).toBeInstanceOf(api.Drawing); const drawing = contents[0] as api.Drawing; expect(drawing.has_picture).toBe(true); const bytes = drawing.image.blob; expect(bytes).toEqual(image); bytes[0] = 0; expect(drawing.image.blob).toEqual(image); }
    await document.save(sink);
  } else if (route === "sdk") { const result = await api.applyStyleModelBatch(input, { version: 1, operations }, context); observe(result.results.map(item => item.value)); await result.save(sink); }
  else {
    const fs = new MemoryFileSystem(), destination = encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/output", destination); await fs.writeFile("/operations", encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    const mutates = row <= 1624;
    try { const result = await shell.exec(`docx batch /input --ops-file /operations --timestamp 2026-04-05T06:07:08Z${mutates ? " --output /output --force" : ""} --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); observe(JSON.parse(result.stdout).data.results.map((item: { data: unknown }) => item.data)); expect(await fs.readFile("/input")).toEqual(original); if (!mutates) expect(await fs.readFile("/output")).toEqual(destination); memory.writeFileSync("/output", mutates ? await fs.readFile("/output") : input); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output); assertPackageLinks(saved);
  const dirty = row <= 1624 ? ["word/comments.xml", ...(row === 1622 ? ["[Content_Types].xml"] : [])] : [];
  for (const [name, bytes] of parts) if (!dirty.includes(name)) expect(saved.get(name), name).toEqual(bytes);
  const commentsXml = new TextDecoder().decode(saved.get("word/comments.xml")); expect(commentsXml).toContain("<!--comments retained-->"); expect(commentsXml).toContain("<?audit exact?>");
  const reopened = await api.Document(output, context), comment = reopened.comments.get(empty ? 0 : id)!;
  expect(comment.comment_id).toBe(empty ? 0 : id); expect(comment.timestamp).toEqual(stamp);
  expect(comment.author).toBe(row === 1618 ? "" : row === 1619 ? "Coastal reviewer" : row === 1623 ? "Independent reviewer" : "Archive author");
  expect(comment.initials).toBe(row === 1618 ? "" : row === 1619 ? "CR" : row === 1624 ? "IR" : "AA");
  expect(comment.paragraphs).toHaveLength(defaultComment ? 2 : 1);
  expect(comment.paragraphs[0]!.text).toBe(empty || defaultComment ? "" : "First 海🌊 é");
  if (row === 1620 || row === 1621) { expect(comment.paragraphs[1]!.text).toBe(row === 1620 ? "Second 海🌊" : ""); expect(comment.paragraphs[1]!.style!.name).toBe(row === 1620 ? "Margin note" : "Comment Text"); }
  if (row === 1622 || picture) { const p = comment.paragraphs[row === 1622 ? 1 : 0]!, drawing = [...p.runs[row === 1622 ? 0 : 2]!.iter_inner_content()][0] as api.Drawing; expect(drawing).toBeInstanceOf(api.Drawing); expect(drawing.image.blob).toEqual(image); }
  expect(reopened.paragraphs[0]!.text).toBe("Untouched 日本 עברית"); expect(input).toEqual(original); expect(memory.readFileSync("/input")).toEqual(Buffer.from(original));
});
