import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { createRegistry } from "./registry.js";
import { readGnumeric } from "./gnumeric.js";
import type { Workbook } from "../workbook.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100000, outputBytes: 1000000, cells: 1000, sheets: 10, operations: 1000 } };
const book: Workbook = { sheets: [{ id: "s1", name: "S & é", cells: [
  { row: 1, column: 1, value: { kind: "string", value: '<&"é\nX' } },
  { row: 2, column: 2, value: { kind: "number", value: -12.5 } }
] }, { id: "s2", name: "Empty", cells: [] }] };
const table = '<p></p><table cellspacing="0" cellpadding="3">\n<caption>S &amp; &#233;</caption>\n<tr>\n<td  valign="bottom"  align="left"  style=" font-size:10pt;">&lt;&amp;&quot;&#233;<br>\nX</td>\n<td  style=""></td>\n</tr>\n<tr>\n<td  style=""></td>\n<td  valign="bottom"  align="right"  style=" font-size:10pt;">&#8722;12.5</td>\n</tr>\n</table>\n';
it("exports native fragment bytes including empty-sheet extent and numeric entities", async () => {
  const codec = createRegistry([]).select("write", "Gnumeric_html:html40frag")!;
  expect(codec.write).toBeTypeOf("function");
  expect(await codec.write!(book, [], context)).toEqual(new TextEncoder().encode(table + '<p></p><table cellspacing="0" cellpadding="3">\n<caption>Empty</caption>\n<tr>\n<td  style=""></td>\n</tr>\n</table>\n'));
});

it("matches captured html32 document bytes", async () => {
  const codec = createRegistry([]).select("write", "Gnumeric_html:html32")!;
  expect(await codec.write!(book, [], context)).toEqual(new TextEncoder().encode("<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 3.2 Final//EN\">\n<html>\n<head>\n\t<title>Tables</title>\n<meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\">\n<meta name=\"generator\" content=\"Gnumeric 1.12.61 via GPFH/0.5\">\n<style><!--\ntt {\n\tfont-family: courier;\n}\ntd {\n\tfont-family: helvetica, sans-serif;\n}\ncaption {\n\tfont-family: helvetica, sans-serif;\n\tfont-size: 14pt;\n\ttext-align: left;\n}\n--></style>\n</head>\n<body>\n<p><table border=\"1\">\n<caption>S &amp; &#233;</caption>\n<tr>\n<td  valign=\"bottom\"  align=\"left\" >&lt;&amp;&quot;&#233;<br>\nX</td>\n<td ></td>\n</tr>\n<tr>\n<td ></td>\n<td  valign=\"bottom\"  align=\"right\" >&#8722;12.5</td>\n</tr>\n</table>\n<p><table border=\"1\">\n<caption>Empty</caption>\n<tr>\n<td ></td>\n</tr>\n</table>\n</body>\n</html>\n"));
});

it("matches captured html40 document bytes", async () => {
  const codec = createRegistry([]).select("write", "Gnumeric_html:html40")!;
  expect(await codec.write!(book, [], context)).toEqual(new TextEncoder().encode("<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01//EN\"\n\t\t\"http://www.w3.org/TR/html4/strict.dtd\">\n<html>\n<head>\n\t<title>Tables</title>\n<meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\">\n<meta name=\"generator\" content=\"Gnumeric 1.12.61 via GPFH/0.5\">\n<style type=\"text/css\">\ntt {\n\tfont-family: courier;\n}\ntd {\n\tfont-family: helvetica, sans-serif;\n}\ncaption {\n\tfont-family: helvetica, sans-serif;\n\tfont-size: 14pt;\n\ttext-align: left;\n}\n.underline { text-decoration: underline; }\n.lowunderline { text-decoration: underline; text-underline-offset: 0.4em; }\n.doubleunderline { text-decoration: underline double; }\n.lowdoubleunderline { text-decoration: underline double; text-underline-offset: 0.4em; }\n.errorunderline { text-decoration: underline wavy; }\n</style>\n</head>\n<body>\n<p></p><table cellspacing=\"0\" cellpadding=\"3\">\n<caption>S &amp; &#233;</caption>\n<tr>\n<td  valign=\"bottom\"  align=\"left\"  style=\" font-size:10pt;\">&lt;&amp;&quot;&#233;<br>\nX</td>\n<td  style=\"\"></td>\n</tr>\n<tr>\n<td  style=\"\"></td>\n<td  valign=\"bottom\"  align=\"right\"  style=\" font-size:10pt;\">&#8722;12.5</td>\n</tr>\n</table>\n<p></p><table cellspacing=\"0\" cellpadding=\"3\">\n<caption>Empty</caption>\n<tr>\n<td  style=\"\"></td>\n</tr>\n</table>\n</body>\n</html>\n"));
});

it("matches captured xhtml document bytes", async () => {
  const codec = createRegistry([]).select("write", "Gnumeric_html:xhtml")!;
  expect(await codec.write!(book, [], context)).toEqual(new TextEncoder().encode("<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Transitional//EN\"\n\t\t\"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\">\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xml:lang=\"en\" lang=\"en\">\n<head>\n\t<title>Tables</title>\n<meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\" />\n<meta name=\"generator\" content=\"Gnumeric 1.12.61 via GPFH/0.5\" />\n<style type=\"text/css\">\ntt {\n\tfont-family: courier;\n}\ntd {\n\tfont-family: helvetica, sans-serif;\n}\ncaption {\n\tfont-family: helvetica, sans-serif;\n\tfont-size: 14pt;\n\ttext-align: left;\n}\n.underline { text-decoration: underline; }\n.lowunderline { text-decoration: underline; text-underline-offset: 0.4em; }\n.doubleunderline { text-decoration: underline double; }\n.lowdoubleunderline { text-decoration: underline double; text-underline-offset: 0.4em; }\n.errorunderline { text-decoration: underline wavy; }\n</style>\n</head>\n<body>\n<p></p><table cellspacing=\"0\" cellpadding=\"3\">\n<caption>S &amp; &#233;</caption>\n<tr>\n<td  valign=\"bottom\"  align=\"left\"  style=\" font-size:10pt;\">&lt;&amp;&quot;&#233;<br>\nX</td>\n<td  style=\"\"></td>\n</tr>\n<tr>\n<td  style=\"\"></td>\n<td  valign=\"bottom\"  align=\"right\"  style=\" font-size:10pt;\">&#8722;12.5</td>\n</tr>\n</table>\n<p></p><table cellspacing=\"0\" cellpadding=\"3\">\n<caption>Empty</caption>\n<tr>\n<td  style=\"\"></td>\n</tr>\n</table>\n</body>\n</html>\n"));
});

it("matches captured xhtml_range document bytes", async () => {
  const codec = createRegistry([]).select("write", "Gnumeric_html:xhtml_range")!;
  expect(await codec.write!(book, [], context)).toEqual(new TextEncoder().encode("<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Transitional//EN\"\n\t\t\"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\">\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xml:lang=\"en\" lang=\"en\">\n<head>\n\t<title>Tables</title>\n<meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\" />\n<meta name=\"generator\" content=\"Gnumeric 1.12.61 via GPFH/0.5\" />\n<style type=\"text/css\">\ntt {\n\tfont-family: courier;\n}\ntd {\n\tfont-family: helvetica, sans-serif;\n}\ncaption {\n\tfont-family: helvetica, sans-serif;\n\tfont-size: 14pt;\n\ttext-align: left;\n}\n.underline { text-decoration: underline; }\n.lowunderline { text-decoration: underline; text-underline-offset: 0.4em; }\n.doubleunderline { text-decoration: underline double; }\n.lowdoubleunderline { text-decoration: underline double; text-underline-offset: 0.4em; }\n.errorunderline { text-decoration: underline wavy; }\n</style>\n</head>\n<body>\n<p></p><table cellspacing=\"0\" cellpadding=\"3\">\n<tr>\n<td  valign=\"bottom\"  align=\"left\"  style=\" font-size:10pt;\">&lt;&amp;&quot;&#233;<br>\nX</td>\n<td  style=\"\"></td>\n</tr>\n<tr>\n<td  style=\"\"></td>\n<td  valign=\"bottom\"  align=\"right\"  style=\" font-size:10pt;\">&#8722;12.5</td>\n</tr>\n</table>\n</body>\n</html>\n"));
});

it("selects XHTML as the default .html saver and retains range split metadata", () => {
 const registry = createRegistry([]);
 expect(registry.select("write", undefined, "book.html")?.id).toBe("Gnumeric_html:xhtml");
 const range = registry.select("write", "Gnumeric_html:xhtml_range")!;
 expect(range.saveScope).toBe("range"); expect(range.sheetSelection).toBe(false); expect(range.honorsExportRange).toBe(false);
});
it("segments overlapping markup in native byte-offset order", async () => {
 const codec = createRegistry([]).select("write", "Gnumeric_html:html40frag")!;
 const rich: Workbook = { sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0, value: { kind: "string", value: "abcd" }, richText: [
  { start: 0, end: 2, attributes: { bold: 1 } }, { start: 1, end: 3, attributes: { italic: 1 } }
 ] }] }] };
 expect(new TextDecoder().decode(await codec.write!(rich, [], context))).toBe('<p></p><table cellspacing="0" cellpadding="3">\n<caption>S</caption>\n<tr>\n<td  valign="bottom"  align="left"  style=" font-size:10pt;"><b>a</b><b><i>b</i></b><i>c</i>d</td>\n</tr>\n</table>\n');
});
it("exports formulas as displayed by the sheet rather than their calculated cache", async () => {
 const codec = createRegistry([]).select("write", "Gnumeric_html:html40frag")!;
 const formula: Workbook = { sheets: [{ id: "s", name: "S", view: { gnumeric: { DisplayFormulas: "1" } }, cells: [
  { row: 0, column: 0, formula: "=1+2", cachedResult: { kind: "number", value: 3 }, value: { kind: "number", value: 3 } }
 ] }] };
 expect(new TextDecoder().decode(await codec.write!(formula, [], context))).toBe('<p></p><table cellspacing="0" cellpadding="3">\n<caption>S</caption>\n<tr>\n<td  valign="bottom"  align="left"  style=" font-size:10pt;">=1+2</td>\n</tr>\n</table>\n');
});
it("bounds sparse output work and preserves cancellation reason identity", async () => {
 const codec = createRegistry([]).select("write", "Gnumeric_html:xhtml")!;
 const abort = new AbortController(), reason = Object.freeze({ cancelled: "html" }); abort.abort(reason);
 await expect(codec.write!(book, [], { ...context, signal: abort.signal })).rejects.toBe(reason);
 await expect(codec.write!(book, [], { ...context, limits: { ...context.limits, outputBytes: 20 } })).rejects.toMatchObject({ code: "resource-limit" });
 const sparse: Workbook = { sheets: [{ id: "s", name: "S", cells: [ { row: 0, column: 0, value: { kind: "number", value: 1 } }, { row: 100000, column: 100, value: { kind: "number", value: 2 } } ] }] };
 await expect(codec.write!(sparse, [], { ...context, limits: { ...context.limits, workbookNodes: 4 } })).rejects.toMatchObject({ code: "resource-limit" });
});
it("supplements byte parity with independent DOM structure checks", async () => {
 const { parseDocument, DomUtils } = await import("htmlparser2");
 const codec = createRegistry([]).select("write", "Gnumeric_html:xhtml")!;
 const dom = parseDocument(new TextDecoder().decode(await codec.write!(book, [], context)));
 const html = DomUtils.getElementsByTagName("html", dom)[0]!;
 expect(html.attribs.xmlns).toBe("http://www.w3.org/1999/xhtml");
 const tables = DomUtils.getElementsByTagName("table", dom);
 expect(tables).toHaveLength(2);
 expect(DomUtils.getElementsByTagName("tr", tables[0]!)).toHaveLength(2);
 expect(DomUtils.getElementsByTagName("td", tables[0]!)).toHaveLength(4);
 expect(DomUtils.textContent(DomUtils.getElementsByTagName("caption", tables[0]!)[0]!)).toBe("S & é");
});

it("replaces overlapping style regions on absent blank cells", async () => {
 const imported = await readGnumeric(new TextEncoder().encode("<gnm:Workbook xmlns:gnm=\"http://www.gnumeric.org/v10.dtd\"><gnm:Version Epoch=\"1\" Major=\"12\" Minor=\"61\"/><gnm:SheetNameIndex><gnm:SheetName>S</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet><gnm:Name>S</gnm:Name><gnm:Styles><gnm:StyleRegion startRow=\"0\" endRow=\"99\" startCol=\"0\" endCol=\"9\"><gnm:Style Shade=\"1\" Back=\"0:ffff:0\"><gnm:Font Unit=\"14\" Bold=\"1\">Sans</gnm:Font></gnm:Style></gnm:StyleRegion><gnm:StyleRegion startRow=\"0\" endRow=\"0\" startCol=\"1\" endCol=\"1\"><gnm:Style Fore=\"ffff:0:0\"/></gnm:StyleRegion></gnm:Styles><gnm:Cells><gnm:Cell Row=\"0\" Col=\"0\" ValueType=\"60\">abcd</gnm:Cell><gnm:Cell Row=\"0\" Col=\"2\" ValueType=\"40\">1</gnm:Cell></gnm:Cells></gnm:Sheet></gnm:Sheets></gnm:Workbook>"), context);
 const codec = createRegistry([]).select("write", "Gnumeric_html:html40frag")!;
 expect(new TextDecoder().decode(await codec.write!(imported, [], context))).toBe('<p></p><table cellspacing="0" cellpadding="3">\n<caption>S</caption>\n<tr>\n<td  bgcolor="#00FF00" valign="bottom"  align="left"  style="background:#00FF00; font-size:14pt;"><b>abcd</b></td>\n<td  style=""></td>\n<td  bgcolor="#00FF00" valign="bottom"  align="right"  style="background:#00FF00; font-size:14pt;"><b>1</b></td>\n</tr>\n</table>\n');
});
