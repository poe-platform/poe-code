import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";
import { readGnumeric } from "./gnumeric.js";
import { createRegistry } from "./registry.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100000, outputBytes: 1000000, cells: 1000, sheets: 10, operations: 1000 } };

function fixture(format: string): string {
  return '<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:Version Epoch="1" Major="12" Minor="61"/><gnm:SheetNameIndex><gnm:SheetName>S</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet><gnm:Name>S</gnm:Name><gnm:Cells><gnm:Cell Row="0" Col="0" ValueType="60" ValueFormat="' + format + '">abcd</gnm:Cell></gnm:Cells></gnm:Sheet></gnm:Sheets></gnm:Workbook>';
}

it.each([
  ["@[italic=1:0:4][italic=0:1:3]", "<i>a</i>bc<i>d</i>"],
  ["@[underline=single:0:4][underline=none:1:3]", '<span class="underline">a</span>bc<span class="underline">d</span>'],
])("replays a later rich-text disabling attribute through the command and writer: %s", async (format, content) => {
  const source = fixture(format), volume = Volume.fromJSON({ "/input.gnumeric": source, "/output.html": "previous" });
  const path = (uri: string) => uri.startsWith("file:") ? new URL(uri).pathname : uri;
  const engine = createEngine({ codecs: [], limits: context.limits, environment: context.environment, filesystem: {
    async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(path(uri)) as Uint8Array)]; },
    async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(path(uri), bytes); }
  } });
  const errors: Uint8Array[] = [];
  try {
    const result = await runCommand(["-T", "Gnumeric_html:html40frag", "/input.gnumeric", "/output.html"], engine, { signal: context.signal, stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(new Uint8Array(bytes)); } } });
    expect(result.exitCode).toBe(0);
    expect(errors).toEqual([]);
    const expected = '<p></p><table cellspacing="0" cellpadding="3">\n<caption>S</caption>\n<tr>\n<td  valign="bottom"  align="left"  style=" font-size:10pt;">' + content + '</td>\n</tr>\n</table>\n';
    expect(volume.readFileSync("/output.html", "utf8")).toBe(expected);
    expect(volume.readFileSync("/input.gnumeric", "utf8")).toBe(source);
    const book = await readGnumeric(new TextEncoder().encode(source), context);
    const writer = createRegistry([]).select("write", "Gnumeric_html:html40frag")!.write!;
    expect(await writer(book, [], context)).toEqual(new TextEncoder().encode(expected));
  } finally { await engine.dispose(); }
});

it("preserves rich-text source attribute nesting in reverse order", async () => {
  const book = await readGnumeric(new TextEncoder().encode(fixture("@[rise=8:0:4][bold=1:0:4][italic=1:0:4][strikethrough=1:0:4][underline=single:0:4]")), context);
  const writer = createRegistry([]).select("write", "Gnumeric_html:html40frag")!.write!;
  expect(new TextDecoder().decode(await writer(book, [], context))).toContain('<sup><b><i><span style="text-decoration: line-through;"><span class="underline">abcd</span></span></i></b></sup>');
});
