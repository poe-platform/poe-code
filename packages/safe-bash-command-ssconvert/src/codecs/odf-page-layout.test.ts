import { expect, it } from "vitest";
import { content, context, fixture, office } from "./odf.test.js";
import { readOdf, createOdfWriter } from "./odf.js";
import { unpackOdf } from "./odf-write.test.js";
import { odfAttributes, odfChildren, odfObject } from "./odf-write-support.js";
import type { Workbook } from "../workbook.js";

const style = "urn:oasis:names:tc:opendocument:xmlns:style:1.0";
const nativeLayout = '<style:page-layout style:name="native-layout">' +
  '<style:page-layout-properties style:print-orientation="landscape" fo:margin-left="11pt">' +
  '<style:background-image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="Pictures/page.png"/>' +
  '</style:page-layout-properties>' +
  '<style:header-style><style:header-footer-properties fo:min-height="12pt">' +
  '<style:background-image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="Pictures/header.png"/>' +
  '</style:header-footer-properties></style:header-style>' +
  '<style:footer-style><style:header-footer-properties fo:min-height="13pt">' +
  '<style:background-image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="Pictures/footer.png"/>' +
  '</style:header-footer-properties></style:footer-style></style:page-layout>';
function print(book: Workbook) {
  const info = book.sheets[0]!.unsupportedRecords?.find(r => r.kind === "PrintInformation")?.data;
  const children = odfChildren(info);
  return {
    orientation: odfObject(children.find(n => odfObject(n)?.name === "orientation"))?.text,
    left: odfAttributes(odfChildren(children.find(n => odfObject(n)?.name === "Margins"))
      .find(n => odfObject(n)?.name === "left")).Points
  };
}

it.each(["strict", "extended"] as const)("retains content page layouts and print metadata through %s read/export/read", async profile => {
  // ODF 1.2 office-automatic-styles permits page-layout in content.xml as well
  // as styles.xml; this fixture is independent of the candidate writer.
  const bytes = await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet",
    "content.xml": content('<table:calculation-settings table:automatic-find-labels="false"/>' +
      '<table:table table:name="S" table:style-name="native-table"/>',
    '<style:style style:name="native-table" style:family="table" style:master-page-name="native-master"/>' + nativeLayout),
    "styles.xml": `<office:document-styles xmlns:office="${office}" xmlns:style="${style}">` +
      '<office:master-styles><style:master-page style:name="native-master" style:page-layout-name="native-layout"/>' +
      '</office:master-styles></office:document-styles>' });
  const diagnostics: string[] = [], ctx = { ...context, async diagnostic(d: { code: string }) { diagnostics.push(d.code); } };
  let book = await readOdf(bytes, ctx);
  expect(diagnostics).toEqual([]);
  expect(print(book)).toEqual({ orientation: "landscape", left: "11" });
  for (let cycle = 0; cycle < 2; cycle++) {
    const output = await createOdfWriter(profile)(book, [], ctx);
    const xml = (await unpackOdf(output)).parts.get("content.xml")!;
    expect(xml).toContain('style:name="native-layout"');
    expect(xml).toContain('fo:min-height="12pt"');
    expect(xml).toContain('fo:min-height="13pt"');
    for (const name of ["page", "header", "footer"]) expect(xml).toContain(`xlink:href="Pictures/${name}.png"`);
    book = await readOdf(output, ctx);
    expect(print(book)).toEqual({ orientation: "landscape", left: "11" });
    expect(diagnostics).toEqual([]);
  }
});
