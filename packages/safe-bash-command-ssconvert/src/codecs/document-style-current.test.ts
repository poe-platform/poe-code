import { expect, it } from "vitest";
import { createEngine } from "../engine.js";

// Original overlapping-region fixture, independently exported by 1.12.61.
// The second region replaces the first complete style, including omitted flags.
const source = '<Workbook xmlns="http://www.gnumeric.org/v10.dtd"><Sheets><Sheet><Name>Partial</Name><Styles><StyleRegion startRow="0" endRow="0" startCol="0" endCol="0"><Style WrapText="1"><Font Unit="18" Bold="1">Courier</Font></Style></StyleRegion><StyleRegion startRow="0" endRow="0" startCol="0" endCol="0"><Style><Font Italic="1"/></Style></StyleRegion></Styles><Cells><Cell Row="0" Col="0" ValueType="60">x</Cell></Cells></Sheet></Sheets></Workbook>';

it("replaces an overlapping native style region rather than retaining omitted wrapping", async () => {
  const engine = createEngine({ codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100000, outputBytes: 1000000, cells: 1000, sheets: 10, operations: 1000 } });
  const chunks: Uint8Array[] = [];
  try {
    const result = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode(source)] }, destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } }, exportType: "Gnumeric_html:latex" }, { signal: new AbortController().signal });
    expect(result.exitCode).toBe(0);
    const text = new TextDecoder("latin1").decode(Buffer.concat(chunks));
    expect(text).toContain("\t \\gnumericPB{\\raggedright}\\gnumbox[l]{\\textit{x}}\n");
    expect(text).not.toContain("\\texttt{");
    expect(text).not.toContain("\\textbf{");
  } finally { await engine.dispose(); }
});
