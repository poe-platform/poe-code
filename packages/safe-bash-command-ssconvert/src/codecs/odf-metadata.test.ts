import { expect, it } from "vitest";
import { parseXml } from "@poe-code/safe-fs/xml";
import { odfCellStyle, odfSheetMetadata } from "./odf-metadata.js";

const office = "urn:oasis:names:tc:opendocument:xmlns:office:1.0", table = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
const text = "urn:oasis:names:tc:opendocument:xmlns:text:1.0", style = "urn:oasis:names:tc:opendocument:xmlns:style:1.0";
function xml(body: string) {
  return parseXml(`<table:table xmlns:table="${table}" xmlns:office="${office}" xmlns:text="${text}" xmlns:style="${style}" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/">${body}</table:table>`);
}
it("maps cell font/alignment/protection/colors into the shared Gnumeric style model", () => {
  const node = xml('<style:style style:family="table-cell"><style:table-cell-properties fo:background-color="#ff0000" fo:wrap-option="wrap" style:cell-protect="protected"/><style:text-properties fo:font-family="Serif" fo:font-size="12pt" fo:font-weight="bold" fo:font-style="italic" fo:color="#0080ff"/><style:paragraph-properties fo:text-align="end"/></style:style>').children[0]!;
  expect(odfCellStyle(node, undefined, () => {})).toMatchObject({ name: "Style", attributes: [
    { name: "Back", value: "FFFF:0:0" }, { name: "Shade", value: "1" },
    { name: "WrapText", value: "1" }, { name: "Locked", value: "1" },
    { name: "Fore", value: "0:8080:FFFF" }, { name: "HAlign", value: "GNM_HALIGN_RIGHT" }],
  children: [{ name: "Font", text: "Serif", attributes: [
    { name: "Unit", value: "12" }, { name: "Bold", value: "1" }, { name: "Italic", value: "1" }] }] });
});
it("retains comments as Gnumeric objects and maps passive hyperlinks without network I/O", () => {
  const sheet = xml('<table:table-row><table:table-cell office:value-type="string"><text:p><text:a xlink:href="https://example.invalid/a">label</text:a></text:p><office:annotation><dc:creator>Ada</dc:creator><text:p>note</text:p></office:annotation></table:table-cell></table:table-row>');
  const records = odfSheetMetadata(sheet, () => {});
  expect(records.find(r => r.kind === "Objects")).toMatchObject({ kind: "Objects", data: { children: [{ name: "CellComment", attributes: [
    { name: "ObjectBound", value: "A1" }, { name: "ObjectOffset", value: "1 0 1 0" }, { name: "Direction", value: "17" },
    { name: "Print", value: "1" }, { name: "Author", value: "Ada" }, { name: "Text", value: "note" }] }] } });
  expect(JSON.stringify(records)).toContain('https://example.invalid/a');
  expect(JSON.stringify(records)).toContain('GnmHLinkURL');
});
