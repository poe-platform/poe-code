import { expect, it } from "vitest";
import { Document, StaleHandleError } from "./index.js";
import { textContext, textFixture, table, w } from "../tests/fixtures/text.js";

it.each(["paragraph", "cell"])("retains linked note and comment references during %s text assignment", async scope => {
  const content = '<w:p><w:commentRangeStart w:id="0"/><w:r><w:footnoteReference w:id="1"/><w:t>Old</w:t><w:endnoteReference w:id="2"/></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>';
  const document = await Document(await textFixture(scope === "cell" ? table([content]) : content, {
    footnotes: { kind: "footnotes", xml: `<w:footnotes xmlns:w="${w}"><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/><w:t>Foot body</w:t></w:r></w:p></w:footnote></w:footnotes>` },
    endnotes: { kind: "endnotes", xml: `<w:endnotes xmlns:w="${w}"><w:endnote w:id="2"><w:p><w:r><w:endnoteRef/><w:t>End body</w:t></w:r></w:p></w:endnote></w:endnotes>` },
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="0" w:author="Author"><w:p><w:r><w:t>Comment body</w:t></w:r></w:p></w:comment></w:comments>` }
  }), textContext);
  const owner = scope === "cell" ? document.tables[0]!.cell(0, 0) : document.paragraphs[0]!;
  const paragraph = scope === "cell" ? document.tables[0]!.cell(0, 0).paragraphs[0]! : document.paragraphs[0]!;
  const runs = paragraph.runs;
  const markers = runs.flatMap(run => run.element.children.filter(n => n.localName.endsWith("Reference")));
  owner.text = "New";
  expect(owner.text).toBe("New");
  const resulting = scope === "cell" ? document.tables[0]!.cell(0, 0).paragraphs[0]! : document.paragraphs[0]!;
  expect(resulting.runs.flatMap(run => run.element.children.map(node =>
    node.localName === "t" ? node.text : node.localName))).toEqual([
      "footnoteReference", "New", "endnoteReference", "commentReference"
    ]);
  expect(markers.map(n => n.localName)).toEqual(["footnoteReference", "endnoteReference", "commentReference"]);
  for (const run of runs) expect(() => run.text).toThrow(StaleHandleError);
  expect(document.comments.get(0)!.text).toBe("Comment body");
  owner.text = "";
  expect(markers.map(n => n.localName)).toEqual(["footnoteReference", "endnoteReference", "commentReference"]);
});
