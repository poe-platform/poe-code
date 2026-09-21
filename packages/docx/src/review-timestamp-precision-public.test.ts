import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage, xmlStructure } from "../tests/assertions.js";

type Node = ReturnType<typeof xmlStructure>;
function elements(root: Node): Node[] {
  return [root, ...root.children.flatMap(child => typeof child === "string" ? [] : elements(child))];
}
const storedDate = "2001-01-02T03:04:05.678Z";
const storedComment = `<w:comment w:id="7" w:author="Stored" w:date="${storedDate}"><w:p><w:r><w:t>Historical note</w:t></w:r></w:p></w:comment>`;
const storedRevision = `<w:ins w:id="42" w:author="Stored" w:date="${storedDate}"><w:r><w:t>Historic</w:t></w:r></w:ins>`;
const target = '<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>Coast</w:t></w:r><!--retain--><?audit unchanged?></w:p>';
const oldAnchor = '<w:p><w:commentRangeStart w:id="7"/><w:r><w:t>Old</w:t></w:r><w:commentRangeEnd w:id="7"/><w:r><w:commentReference w:id="7"/></w:r></w:p>';
const timestamps = ["2024-02-29T01:02:03.999Z", "1969-12-31T23:59:59.999Z"];
const routes = ["sdk", "cli", "sdk-batch-item", "sdk-batch-default", "cli-batch-item", "cli-batch-default"];
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const timestamp of timestamps) for (const operation of ["comments.add", "revisions.add", "text.replace", "model-comment"] as const)
for (const route of operation === "model-comment" ? ["model", "model-sdk", "model-cli"] : routes)
it(`review whole-second creation; strict=${strict}; kind=${kind}; time=${timestamp}; operation=${operation}; route=${route}`, async () => {
  const input = await textFixture(target + oldAnchor + `<w:p>${storedRevision}</w:p>`, {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}">${storedComment}<!--comments-retained--></w:comments>` },
    header: { kind: "header", xml: `<w:hdr xmlns:w="${w}"><w:p><w:r><w:t>Retained header</w:t></w:r></w:p></w:hdr>` },
    styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="Comment Text"/></w:style><w:style w:type="character" w:styleId="CommentReference"><w:name w:val="Comment Reference"/></w:style></w:styles>` }
  }, strict, { kind });
  const saved = input.slice(), memory = Volume.fromJSON({ "/out": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink };
  const doc = await api.openDocumentLocations(input, textContext), select = doc.range(doc.at("paragraph", 1).token, 0, 5).token;
  const metadata = { author: "", timestamp };
  const args = operation === "comments.add" ? { select, text: "New note", initials: null } : operation === "revisions.add" ? { paragraph: 1, kind: "insert" as const, text: "Pier" } : { paragraph: 1, find: "Coast", with: "Shore", first: true, trackChanges: true as const };
  const operations = operation === "model-comment" ? [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" },
    { operation: "model.document.Document.add_comment.call", receiver: ref("document"), arguments: { runs: ref("runs", 0), text: "New note", author: "", initials: null } }
  ] : [{ operation, arguments: { ...args, ...(route.endsWith("default") ? {} : metadata) } }];
  // Only tracked replacement inherits outer utility metadata (docx.md:1072).
  const outerOnlyRefusal = route.endsWith("default") && (operation === "comments.add" || operation === "revisions.add");
  if (route === "sdk") {
    if (operation === "comments.add") await api.editDocumentComments(input, { operation, options: { select, text: "New note", initials: null, ...metadata, output: "-" } }, context);
    else if (operation === "revisions.add") await api.editDocumentRevisions(input, { paragraph: 1, kind: "insert", text: "Pier", ...metadata, output: "-" }, context);
    else await api.replaceDocumentText(input, { paragraph: 1, find: "Coast", with: "Shore", first: true, trackChanges: true, ...metadata, output: "-" }, context);
  } else if (route.startsWith("sdk-batch")) {
    const pending = api.executeDocumentBatch(input, { version: 1, operations } as api.DocumentBatchInput, { output: "-", ...(route.endsWith("default") ? metadata : {}) }, context);
    if (outerOnlyRefusal) {
      await expect(pending).rejects.toMatchObject({ code: "usage" });
      expect(input).toEqual(saved); expect(memory.statSync("/out").size).toBe(0);
      return;
    }
    await pending;
  } else if (route === "model") {
    const model = await api.Document(input, { ...context, timestamp: new Date(timestamp) });
    const comment = model.add_comment(model.paragraphs[0]!.runs[0]!, "New note", "", null);
    expect(comment.timestamp!.getTime()).toBe(Math.floor(Date.parse(timestamp) / 1000) * 1000);
    await model.save(sink);
  } else if (route === "model-sdk") {
    const model = await api.applyStyleModelBatch(input, { version: 1, operations }, { ...context, timestamp: new Date(timestamp) });
    await model.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const options = operation === "comments.add" ? `--select '${select}' --text 'New note' --initials null` : operation === "revisions.add" ? "--paragraph 1 --kind insert --text Pier" : "--paragraph 1 --find Coast --with Shore --first --track-changes";
      const command = route === "cli" ? `docx ${operation.split(".").join(" ")} /input ${options} --author '' --timestamp ${timestamp}` : `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}'${route.endsWith("default") || route === "model-cli" ? ` --author '' --timestamp ${timestamp}` : ""}`;
      const result = await shell.exec(command + " --output /out --force --json");
      if (outerOnlyRefusal) {
        expect(result.exitCode).toBe(2);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, affected: 0, errors: [{ code: "usage" }] });
        expect(await fs.readFile("/input")).toEqual(saved);
        expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Retained destination");
        expect(memory.statSync("/out").size).toBe(0);
        return;
      }
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, errors: [] });
      expect(await fs.readFile("/input")).toEqual(saved);
      memory.writeFileSync("/out", await fs.readFile("/out"));
    } finally { await shell.dispose(); }
  }
  expect(input).toEqual(saved);
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
  assertPackageLinks(after);
  expect([...after.keys()]).toEqual([...before.keys()]);
  const isComment = operation === "comments.add" || operation === "model-comment";
  for (const [name, bytes] of before) if (name !== "word/document.xml" && !(isComment && name === "word/comments.xml")) expect(after.get(name), name).toEqual(bytes);
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const main = new TextDecoder().decode(after.get("word/document.xml")), comments = new TextDecoder().decode(after.get("word/comments.xml"));
  expect(main).toContain(storedRevision); expect(comments).toContain(storedComment);
  for (const trivia of ["<!--retain-->", "<?audit unchanged?>", "<!--comments-retained-->"]) expect(main + comments).toContain(trivia);
  const nodes = elements(xmlStructure(after.get(isComment ? "word/comments.xml" : "word/document.xml")!));
  const created = nodes.filter(node => [isComment ? `{${word}}comment` : `{${word}}ins`, ...(operation === "text.replace" ? [`{${word}}del`] : [])].includes(node.name) && node.attributes[`{${word}}author`] === "");
  expect(created).toHaveLength(operation === "text.replace" ? 2 : 1);
  for (const node of created) {
    const date = node.attributes[`{${word}}date`]!;
    expect(Date.parse(date), date).toBe(Math.floor(Date.parse(timestamp) / 1000) * 1000);
    expect(date).toBe(timestamp.slice(0, 19) + (operation === "model-comment" ? ".000Z" : "Z"));
  }
  const final = operation === "text.replace" ? "Shore" : operation === "revisions.add" ? "CoastPier" : "Coast";
  expect((await api.extractDocumentText(output, textContext)).text).toBe(final + "\nOld\nHistoric");
  expect((await api.extractDocumentText(output, textContext, { view: "original" })).text).toBe("Coast\nOld\n");
  expect((await api.extractDocumentText(output, textContext, { view: "all" })).text).toBe((operation === "text.replace" ? "CoastShore" : final) + "\nOld\nHistoric");
  expect((await api.inspectDocumentComments(output, { operation: "comments.list", options: {} }, textContext)).items.find(item => item.comment_id === 7)!.timestamp).toBe(storedDate);
  const revisions = await api.inspectDocumentRevisions(output, {}, textContext);
  expect(revisions.items.find(item => item.id === "42")?.timestamp).toBe(storedDate);
});
