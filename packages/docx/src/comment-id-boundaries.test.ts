import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const cases = [
  { name: "empty", ids: [], expected: 0 },
  { name: "sparse", ids: [1], expected: 2 },
  { name: "maximum-minus-one", ids: [4, 2147483646], expected: 2147483647 },
  { name: "maximum", ids: [1, 2147483647], expected: 0 },
  { name: "contiguous", ids: [1, 2, 3], expected: 4 },
  { name: "maximum-with-leading-ids", ids: [0, 1, 2, 2147483647], expected: 3 },
  { name: "maximum-with-gap", ids: [0, 2, 2147483647], expected: 1 }
];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["collection-model", "document-model", "sdk", "shell", "utility-sdk", "utility-shell"] as const)
it.each(cases)(`${route} allocates $name comment IDs without changing prior bindings; ${kind} strict=${strict}`, async sample => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const body = sample.ids.map(id => `<w:p><w:commentRangeStart w:id="${id}"/><w:r><w:t>Existing ${id}</w:t></w:r><w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r></w:p>`).join("") + "<w:p><w:r><w:t>Fresh range</w:t></w:r></w:p>";
  const { input: original, relationships } = await nativeStoryFixture("document.DocumentPart", strict, kind, body);
  const parts = readPackage(original), comments = sample.ids.map(id => `<w:comment w:id="${id}" w:author="Coast"><w:p><w:r><w:t>Prior ${id}</w:t></w:r></w:p></w:comment>`);
  parts.set("word/comments.xml", enc(`<w:comments xmlns:w="${word}">${comments.join("")}</w:comments>`));
  parts.set("word/_rels/document.xml.rels", enc(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="comments" Type="${relationships}/comments" Target="comments.xml"/></Relationships>`));
  parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("</Types>", '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>')));
  const volume = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { compression: "store", order: "input" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), context = { ...textContext, timestamp: new Date("2026-02-03T04:05:06Z"), encoding: { compression: "store", order: "input" } as const };
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", sample.ids.length), arguments: {}, resultHandle: "runs" },
    { operation: "model.document.Document.add_comment.call", receiver: ref("document"), arguments: { runs: ref("runs", 0), text: "New note", author: "Estuary" }, resultHandle: "new" },
    { operation: "model.comments.Comment.comment_id.get", receiver: ref("new"), arguments: {} }
  ];
  const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/output", bytes); } };
  if (route === "utility-sdk" || route === "utility-shell") {
    const locations = await api.openDocumentLocations(input, textContext), select = locations.range(locations.at("paragraph", sample.ids.length + 1).token, 0, 11).token;
    if (route === "utility-sdk") await api.editDocumentComments(input, { operation: "comments.add", options: { select, text: "New note", author: "Estuary", timestamp: context.timestamp.toISOString(), output: "-" } }, { ...context, stdout: sink });
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
      try { const result = await shell.exec(`docx comments add /input --select '${select}' --text 'New note' --author Estuary --timestamp 2026-02-03T04:05:06Z --output /output --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); volume.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); }
      finally { await shell.dispose(); }
    }
  } else if (route === "collection-model" || route === "document-model") {
    const doc = await api.Document(input, context);
    const added = route === "collection-model" ? doc.comments.add_comment("New note", "Estuary") : doc.add_comment(doc.paragraphs[sample.ids.length]!.runs[0]!, "New note", "Estuary");
    expect(added.comment_id).toBe(sample.expected); expect(doc.comments.get(sample.expected)!.text).toBe("New note");
    await doc.save(sink);
  } else if (route === "sdk") {
    const result = await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-", timestamp: context.timestamp.toISOString() }, { ...context, stdout: sink });
    expect(result.results[3]!.data).toBe(sample.expected);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --timestamp 2026-02-03T04:05:06Z --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).data.results[3].data).toBe(sample.expected); volume.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/output") as Buffer), saved = readPackage(output), xml = new TextDecoder().decode(saved.get("word/comments.xml"));
  for (const previous of comments) expect(xml).toContain(previous);
  for (const [name, bytes] of parts) if (!["[Content_Types].xml", "word/document.xml", "word/comments.xml", "word/_rels/document.xml.rels"].includes(name)) expect(saved.get(name), name).toEqual(bytes);
  const walk = (node: ReturnType<typeof xmlStructure>): ReturnType<typeof xmlStructure>[] => [node, ...node.children.flatMap(n => typeof n === "string" ? [] : walk(n))];
  const edges = walk(xmlStructure(saved.get("word/_rels/document.xml.rels")!)).filter(n => n.name.endsWith("}Relationship"));
  expect(edges.find(n => n.attributes["{}Id"] === "comments")!.attributes).toEqual({ "{}Id": "comments", "{}Type": relationships + "/comments", "{}Target": "comments.xml" });
  const reopened = await api.Document(output, textContext); expect([...reopened.comments].map(comment => comment.comment_id)).toEqual([...sample.ids, sample.expected]);
  expect(reopened.comments.get(sample.expected)!.text).toBe("New note"); expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
