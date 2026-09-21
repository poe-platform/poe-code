import { expect, it } from "vitest";
import { Document, StaleHandleError } from "./index.js";
import { textContext, textFixture, table, w } from "../tests/fixtures/text.js";

it("accepts explicit null add_run text as an empty owned run", async () => {
  const document = await Document(undefined, textContext);
  const paragraph = document.paragraphs[0]!;
  const run = paragraph.add_run(null);
  expect(run.text).toBe("");
  expect(run.equals(paragraph.runs[0])).toBe(true);
  run.text = "Filled";
  expect(paragraph.text).toBe("Filled");
});

it("binds inserted raw children to owner identity and supports their removal", async () => {
  const document = await Document(undefined, textContext);
  const paragraph = document.paragraphs[0]!;
  const inserted = paragraph.element.insert(0, {
    kind: "element",
    name: { namespaceURI: w, localName: "r" },
    children: [
      {
        kind: "element",
        name: { namespaceURI: w, localName: "t" },
        children: [{ kind: "text", text: "Inserted" }]
      }
    ]
  });
  const text = inserted.children[0]!;
  paragraph.add_run("Sibling");
  expect(text.text).toBe("Inserted");
  inserted.remove();
  expect(() => inserted.localName).toThrow(StaleHandleError);
  expect(() => text.text).toThrow(StaleHandleError);
  expect(paragraph.text).toBe("Sibling");
});

it("invalidates raw run children on identical paragraph text replacement", async () => {
  const document = await Document(undefined, textContext);
  const paragraph = document.paragraphs[0]!;
  paragraph.text = "Same";
  paragraph.text = "Same";
  const rawRun = paragraph.element.children[0]!;
  const rawText = rawRun.children[0]!;
  paragraph.text = "Same";
  expect(() => rawRun.localName).toThrow(StaleHandleError);
  expect(() => rawText.text).toThrow(StaleHandleError);
});

it("invalidates raw text children while retaining run properties on identical run assignment", async () => {
  const document = await Document(undefined, textContext);
  const run = document.paragraphs[0]!.add_run("Same");
  run.bold = true;
  run.text = "Same";
  run.text = "Same";
  const props = run.element.children[0]!;
  const text = run.element.children[1]!;
  run.text = "Same";
  expect(() => text.text).toThrow(StaleHandleError);
  expect(props.localName).toBe("rPr");
  expect(run.bold).toBe(true);
});

it("invalidates replaced runs even when paragraph text serializes identically", async () => {
  const document = await Document(undefined, textContext);
  const paragraph = document.paragraphs[0]!;
  const run = paragraph.add_run("Same");
  const element = run.element;
  const sibling = document.add_paragraph("Retained");
  paragraph.text = "Same";
  expect(() => run.text).toThrow(StaleHandleError);
  expect(() => element.serialize()).toThrow(StaleHandleError);
  expect(paragraph.text).toBe("Same");
  expect(sibling.text).toBe("Retained");
});

it("invalidates empty runs on clear while retaining the paragraph and its properties", async () => {
  const document = await Document(undefined, textContext);
  const paragraph = document.paragraphs[0]!;
  paragraph.paragraph_format.keep_with_next = true;
  const run = paragraph.add_run();
  expect(paragraph.clear()).toBe(paragraph);
  expect(() => run.text).toThrow(StaleHandleError);
  expect(paragraph.paragraph_format.keep_with_next).toBe(true);
  expect(paragraph.text).toBe("");
});

it("retains run identity and formatting during destructive run text assignment", async () => {
  const document = await Document(undefined, textContext);
  const run = document.paragraphs[0]!.add_run("Same");
  const font = run.font;
  font.bold = true;
  run.text = "Same";
  expect(run.equals(document.paragraphs[0]!.runs[0])).toBe(true);
  expect(run.clear()).toBe(run);
  expect(font.bold).toBe(true);
});

it("maps nullable paragraph text to explicit clear without accepting nullable run text", async () => {
  const document = await Document(undefined, textContext);
  const paragraph = document.paragraphs[0]!;
  const run = paragraph.add_run("Removed");
  paragraph.text = null;
  expect(paragraph.text).toBe("");
  expect(() => run.text).toThrow(StaleHandleError);
  const retained = paragraph.add_run("Retained");
  expect(() => {
    retained.text = null as unknown as string;
  }).toThrow();
  expect(retained.text).toBe("Retained");
});

it("retains annotation owners when paragraph assignment removes their runs", async () => {
  const document = await Document(
    await textFixture(
      '<w:p><w:bookmarkStart w:id="1" w:name="Anchor"/><w:r><w:t>Old</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
    ),
    textContext
  );
  const paragraph = document.paragraphs[0]!;
  const marker = paragraph.element.children[0]!;
  const run = paragraph.runs[0]!;
  paragraph.text = "New";
  expect(marker.localName).toBe("bookmarkStart");
  expect(() => run.text).toThrow(StaleHandleError);
  expect(paragraph.text).toBe("New");
});

it("discards cached page-break metadata and invalidates its handle on paragraph clear", async () => {
  const document = await Document(
    await textFixture("<w:p><w:r><w:t>Old</w:t><w:lastRenderedPageBreak/></w:r></w:p>"),
    textContext
  );
  const paragraph = document.paragraphs[0]!;
  const cached = paragraph.rendered_page_breaks[0]!;
  paragraph.clear();
  expect(paragraph.contains_page_break).toBe(false);
  expect(() => cached.preceding_paragraph_fragment).toThrow(StaleHandleError);
});

it("retains all handles when destructive paragraph assignment rejects protected content", async () => {
  const document = await Document(
    await textFixture(
      '<w:p><w:r><w:t>Retained</w:t><w:fldChar w:fldCharType="begin"/></w:r></w:p>'
    ),
    textContext
  );
  const paragraph = document.paragraphs[0]!;
  const run = paragraph.runs[0]!;
  const element = run.element;
  expect(() => {
    paragraph.text = "Rejected";
  }).toThrow();
  expect(run.text).toBe("Retained");
  expect(element.localName).toBe("r");
});

it("retains note marker owners while invalidating their replaced run owners", async () => {
  const document = await Document(
    await textFixture("<w:p><w:r><w:footnoteRef/><w:t>Old</w:t></w:r></w:p>"),
    textContext
  );
  const paragraph = document.paragraphs[0]!;
  const run = paragraph.runs[0]!;
  const marker = run.element.children[0]!;
  paragraph.text = "New";
  expect(marker.localName).toBe("footnoteRef");
  expect(() => run.text).toThrow(StaleHandleError);
  expect(paragraph.text).toBe("New");
});

it("rejects cell replacement before losing markers spanning paragraphs", async () => {
  const document = await Document(
    await textFixture(
      table([
        '<w:p><w:bookmarkStart w:id="1" w:name="Anchor"/><w:r><w:t>Start</w:t></w:r></w:p><w:p><w:r><w:t>End</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
      ])
    ),
    textContext
  );
  const cell = document.tables[0]!.cell(0, 0);
  const paragraph = cell.paragraphs[0]!;
  const run = paragraph.runs[0]!;
  expect(() => {
    cell.text = "Rejected";
  }).toThrow("annotation markers");
  expect(cell.text).toBe("Start\nEnd");
  expect(run.text).toBe("Start");
});
