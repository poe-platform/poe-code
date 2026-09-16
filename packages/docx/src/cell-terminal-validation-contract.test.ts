import { expect, it } from "vitest";
import { readDocumentArchive, validateDocumentArchive } from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";

it.each(["", "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>"])(
  "reports a cell without its required terminal paragraph",
  async (content) => {
    const input = await textFixture(
      `<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc>${content}</w:tc></w:tr></w:tbl>`
    );
    const report = validateDocumentArchive(await readDocumentArchive(input, textContext));
    expect(report.valid).toBe(false);
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ code: "cell-terminal-paragraph", part: "/word/document.xml" })
    );
  }
);

it.each([
  "<w:p/>",
  "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl><w:p/>",
  '<w:p/><w:bookmarkStart w:id="0" w:name="Coast"/><w:bookmarkEnd w:id="0"/>'
])("accepts a terminal paragraph with retained nested content and annotations", async (content) => {
  const input = await textFixture(
    `<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc>${content}</w:tc></w:tr></w:tbl>`
  );
  expect(validateDocumentArchive(await readDocumentArchive(input, textContext)).valid).toBe(true);
});

it.each([
  "<w:sdt><w:sdtContent><w:p/></w:sdtContent></w:sdt>",
  "<w:customXml><w:p/></w:customXml>",
  '<w:ins w:id="1" w:author="Surveyor" w:date="2026-09-15T12:34:56Z"><w:p/></w:ins>'
])("accepts a terminal paragraph in an admitted block wrapper", async (content) => {
  const input = await textFixture(
    `<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc>${content}</w:tc></w:tr></w:tbl>`
  );
  expect(validateDocumentArchive(await readDocumentArchive(input, textContext)).valid).toBe(true);
});
