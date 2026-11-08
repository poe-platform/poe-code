import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { createRegistry } from "./registry.js";
import { readGnumeric } from "./gnumeric.js";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100000, outputBytes: 1000000, cells: 1000, sheets: 10, operations: 1000 } };

it("encodes hyperlink targets with the reference GLib path character set", async () => {
  const book: Workbook = { sheets: [{ id: "s1", name: "Links", cells: [{ row: 0, column: 0, value: { kind: "string", value: "link" }, style: { gnumeric: { name: "Style", attributes: {}, children: [{ name: "HyperLink", attributes: { type: "GnmHLinkURL", target: "https://x/a?b=1&c=#[]!$'()*+,;:@/% é" }, children: [], text: "" }], text: "" } } }] }] };
  const write = createRegistry([]).select("write", "Gnumeric_html:html40frag")!.write!;
  expect(new TextDecoder().decode(await write(book, [], context))).toBe('<p></p><table cellspacing="0" cellpadding="3">\n<caption>Links</caption>\n<tr>\n<td  valign="bottom"  align="left"  style=" font-size:10pt;"><a href="https://x/a%3Fb=1&c=%23%5B%5D!$\'()*+,;:@/%25%20%C3%A9">link</a></td>\n</tr>\n</table>\n');
});

it("truncates 16-bit style colors and preserves native style nesting and blank cells", async () => {
  const source = '<?xml version="1.0"?><gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:Version Epoch="1" Major="12" Minor="61"/><gnm:SheetNameIndex><gnm:SheetName>Styled</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet><gnm:Name>Styled</gnm:Name><gnm:Styles><gnm:StyleRegion startRow="0" endRow="0" startCol="0" endCol="0"><gnm:Style Fore="00ff:01ff:80ff" Back="ff00:7fff:0080" Shade="1" HAlign="8" VAlign="4"><gnm:Font Unit="12.6" Bold="1" Italic="1" Underline="2" StrikeThrough="1" Script="1">Courier</gnm:Font></gnm:Style></gnm:StyleRegion></gnm:Styles><gnm:Cells><gnm:Cell Row="0" Col="0" ValueType="60">link</gnm:Cell><gnm:Cell Row="1" Col="1" ValueType="40">123</gnm:Cell></gnm:Cells></gnm:Sheet></gnm:Sheets></gnm:Workbook>';
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  const write = createRegistry([]).select("write", "Gnumeric_html:html40frag")!.write!;
  expect(new TextDecoder().decode(await write(book, [], context))).toBe('<p></p><table cellspacing="0" cellpadding="3">\n<caption>Styled</caption>\n<tr>\n<td  bgcolor="#FF7F00" valign="center"  align="center"  style="background:#FF7F00; font-size:13pt; color:#000180;"><i><b><span class="doubleunderline"><tt><span style="text-decoration: line-through;"><sup><font color="#000180">link</font></span></sup></tt></span></b></i></td>\n<td  style=""></td>\n</tr>\n<tr>\n<td  style=""></td>\n<td  valign="bottom"  align="right"  style=" font-size:10pt;">123</td>\n</tr>\n</table>\n');
});

it("retains cancellation identity and rejects output beyond the injected budget", async () => {
  const book: Workbook = { sheets: [{ id: "s1", name: "S", cells: [] }] };
  const write = createRegistry([]).select("write", "Gnumeric_html:html40frag")!.write!;
  const controller = new AbortController(), reason = new Error("cancel HTML export");
  controller.abort(reason);
  await expect(write(book, [], { ...context, signal: controller.signal })).rejects.toBe(reason);
  await expect(write(book, [], { ...context, limits: { ...context.limits, outputBytes: 10 } })).rejects.toMatchObject({ code: "resource-limit", message: "ssconvert HTML output bytes limit exceeded" });
});

it("exports hidden cells and comment extent through the command engine using memfs", async () => {
  const source = '<?xml version="1.0"?><gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:Version Epoch="1" Major="12" Minor="61"/><gnm:SheetNameIndex><gnm:SheetName>Links</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet><gnm:Name>Links</gnm:Name><gnm:Cells><gnm:Cell Row="0" Col="0" ValueType="60">A</gnm:Cell></gnm:Cells><gnm:Rows><gnm:RowInfo No="0" Unit="12" Hidden="1"/></gnm:Rows><gnm:Cols><gnm:ColInfo No="0" Unit="48" Hidden="1"/></gnm:Cols><gnm:Objects><gnm:CellComment Author="QA" Text="comment &amp; &lt;" ObjectBound="B2:B2"/></gnm:Objects></gnm:Sheet></gnm:Sheets></gnm:Workbook>';
  const volume = Volume.fromJSON({ "/input.gnumeric": source });
  const path = (uri: string) => uri.startsWith("file:") ? new URL(uri).pathname : uri;
  const engine = createEngine({ codecs: [], limits: context.limits, environment: context.environment, filesystem: {
    async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(path(uri)) as Uint8Array)]; },
    async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(path(uri), bytes); }
  } });
  const errors: Uint8Array[] = [];
  const result = await runCommand(["-T", "Gnumeric_html:html40frag", "/input.gnumeric", "/output.html"], engine, { signal: context.signal, stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(new Uint8Array(bytes)); } } });
  expect(result.exitCode).toBe(0);
  expect(errors).toEqual([]);
  expect(volume.readFileSync("/output.html", "utf8")).toBe('<p></p><table cellspacing="0" cellpadding="3">\n<caption>Links</caption>\n<tr>\n<td  valign="bottom"  align="left"  style=" font-size:10pt;">A</td>\n<td  style=""></td>\n</tr>\n<tr>\n<td  style=""></td>\n<td  style=""></td>\n</tr>\n</table>\n');
  expect(volume.readFileSync("/input.gnumeric", "utf8")).toBe(source);
  await engine.dispose();
});
