import { expect, it } from "vitest";
import { createRegistry } from "./registry.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100000, outputBytes: 1000000, cells: 1000, sheets: 10, operations: 1000 } };

it("uses the latest overlapping attribute, including an explicit disabled bold run", async () => {
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0, value: { kind: "string", value: "abcd" }, richText: [
    { start: 0, end: 4, attributes: { bold: 1 } },
    { start: 1, end: 3, attributes: { bold: 0 } }
  ] }] }] };
  const writer = createRegistry([]).select("write", "Gnumeric_html:html40frag")!.write!;
  expect(new TextDecoder().decode(await writer(book, [], context))).toBe('<p></p><table cellspacing="0" cellpadding="3">\n<caption>S</caption>\n<tr>\n<td  valign="bottom"  align="left"  style=" font-size:10pt;"><b>a</b>bc<b>d</b></td>\n</tr>\n</table>\n');
});
