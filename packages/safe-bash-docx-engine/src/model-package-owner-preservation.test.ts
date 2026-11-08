import { expect, it } from "vitest";
import { Document, StaleHandleError } from "./index.js";

it("retains live body and paragraph owners when package relationships change", async () => {
  const document = await Document();
  const paragraph = document.add_paragraph("Coast");
  const run = paragraph.add_run(" chart");
  const id = document.part.relate_to("https://coast.invalid/chart", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", true);
  expect(id.startsWith("rId")).toBe(true);
  expect(paragraph.text).toBe("Coast chart");
  expect(run.text).toBe(" chart");
  expect(document.paragraphs.at(-1)).toBe(paragraph);
  run.text = " map";
  expect(paragraph.text).toBe("Coast map");
});

it("invalidates model nodes only in a part replaced through its package view", async () => {
  const document = await Document();
  const body = document.add_paragraph("Before");
  const header = document.sections.at(0).header.paragraphs[0]!;
  header.text = "Header";
  const part = header.part;
  part.element.set_attribute({ namespaceURI: "http://www.w3.org/XML/1998/namespace", localName: "lang" }, "fr");
  expect(body.text).toBe("Before");
  expect(() => header.text).toThrow(StaleHandleError);
});
