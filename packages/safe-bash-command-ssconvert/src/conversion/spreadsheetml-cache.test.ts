import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand } from "../index.js";

const input = new TextEncoder().encode(`<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Sheet1"><Table>
<Row><Cell><Data ss:Type="Number">1</Data></Cell><Cell ss:Formula="=RC[-1]*2"><Data ss:Type="Number">999</Data></Cell></Row>
<Row><Cell><Data ss:Type="Number">3</Data></Cell><Cell ss:Formula="=SUM(R1C1:R2C1)"><Data ss:Type="Number">999</Data></Cell></Row>
</Table></Worksheet></Workbook>`);

it.each([false, true])("preserves SpreadsheetML caches unless recalculation is requested (recalc=%s)", async recalc => {
  const volume = Volume.fromJSON({ "/input.xml": new TextDecoder().decode(input) });
  const engine = createEngine({ environment: { env: {}, locale: "C", timezone: "UTC" },
    filesystem: { async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); } } });
  const chunks: Uint8Array[] = [];
  const operation = { signal: new AbortController().signal,
    stderr: { async write(bytes: Uint8Array) { throw new Error(new TextDecoder().decode(bytes)); } }, stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } } };
  const expected = recalc ? "1,2\n3,4\n" : "1,999\n3,999\n";
  try {
    const result = await engine.convert({ input: { kind: "stream", filename: "input.xml", source: [input] },
      destination: { kind: "stream", sink: operation.stdout }, exportType: "Gnumeric_stf:stf_csv", recalc }, operation);
    expect(result.exitCode).toBe(0);
    expect(chunks.map(bytes => new TextDecoder().decode(bytes)).join("")).toBe(expected);
    chunks.length = 0;
    const command = await runCommand([...(recalc ? ["--recalc"] : []), "-T", "Gnumeric_stf:stf_csv", "/input.xml", "fd://1"], engine, operation);
    expect(command.exitCode).toBe(0);
    expect(chunks.map(bytes => new TextDecoder().decode(bytes)).join("")).toBe(expected);
  } finally { await engine.dispose(); }
});
