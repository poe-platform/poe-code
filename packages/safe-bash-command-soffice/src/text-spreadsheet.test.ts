import assert from "node:assert/strict";
import { test } from "node:test";
import { createEngine } from "@poe-code/spreadsheet-engine";
import { xlsxFormat } from "@poe-code/spreadsheet-format-xlsx";
import { readZipArchiveEntries, runSofficeCli, runSofficeCliSync } from "./index.js";

const fixtures = [
  { extension: "txt", source: 'Name\tValue\n"Alice, Bob"\t"line 1\nline 2"\n', expected: 'Name,Value\n"Alice, Bob","line 1\nline 2"\n' },
  { extension: "md", source: 'Name | Value\n--- | ---\nAlice\\|Bob | 42\n\nOther | Value\n--- | ---\nCarol |\n', expected: "Name,Value\nAlice|Bob,42\nOther,Value\nCarol,\n" },
  { extension: "html", source: '<h1>Visible &amp; clear</h1><p>Body</p><script>hidden</script>', expected: "Visible & clear\nBody\n" },
  { extension: "txt", source: 'Name\tValue\r\nAlice & Bob\t42\r\n', expected: "Name,Value\nAlice & Bob,42\n" },
  { extension: "txt", source: 'Name,Value\n"Alice, Bob",42\n', expected: 'Name,Value\n"Alice, Bob",42\n' },
  { extension: "md", source: '# Report\n\n| Name | Value |\n| :--- | ---: |\n| Alice & Bob | 42 |\n', expected: "Name,Value\nAlice & Bob,42\n" },
  ...["html", "htm"].map(extension => ({ extension, source: '<h1>Report</h1><p>Summary</p><table><tr><th>Name<th>Value<tr><td>Alice &amp; Bob<td>42</table>', expected: "Name,Value\nAlice & Bob,42\n" }))
];
for (const run of [runSofficeCliSync, runSofficeCli]) {
  for (const [index, fixture] of fixtures.entries()) {
    for (const target of ["csv", "xlsx"]) test(`tabular ${fixture.extension} fixture ${index} to ${target} (${run.name})`, async () => {
      const files = new Map([[`/data.${fixture.extension}`, new TextEncoder().encode(fixture.source)]]);
      const result = await run(["--headless", "--convert-to", target, "--outdir", "/out", `/data.${fixture.extension}`], files);
      assert.equal(result.exitCode, 0, result.stderr);
      if (target === "xlsx") {
        assert.ok(readZipArchiveEntries(files.get("/out/data.xlsx")!).has("xl/worksheets/sheet1.xml"));
        const restored = await run(["--convert-to", "csv", "--outdir", "/out", "/out/data.xlsx"], files);
        assert.equal(restored.exitCode, 0, restored.stderr);
      }
      assert.equal(new TextDecoder().decode(files.get("/out/data.csv")), fixture.expected);
    });
  }
  test(`tabular text respects CSV filter options (${run.name})`, async () => {
    const files = new Map([["/data.txt", new TextEncoder().encode("Name\tValue\nAlice\t42\n")]]);
    const result = await run(["--convert-to", "csv:Text - txt - csv (StarCalc):59,34,76,1", "/data.txt"], files);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(files.get("/data.csv")), "Name;Value\nAlice;42\n");
  });
}

test("text XLSX output is readable by the spreadsheet engine", async () => {
  const files = new Map([["/data.txt", new TextEncoder().encode("Name\tValue\nAlice & Bob\t42\n")]]);
  const result = await runSofficeCli(["--convert-to", "xlsx", "/data.txt"], files);
  assert.equal(result.exitCode, 0, result.stderr);
  const engine = createEngine({ formats: [xlsxFormat] });
  try {
    const book = await engine.readWorkbook({ kind: "stream", filename: "data.xlsx", source: [files.get("/data.xlsx")!] }, {}, { signal: new AbortController().signal });
    assert.deepEqual(book.sheets[0]!.cells.map(cell => [cell.row, cell.column, { ...cell.value }]), [
      [0, 0, { kind: "string", value: "Name" }], [0, 1, { kind: "string", value: "Value" }],
      [1, 0, { kind: "string", value: "Alice & Bob" }], [1, 1, { kind: "string", value: "42" }]
    ]);
  } finally { await engine.dispose(); }
});

test("XLSX output preserves columns beyond Z", async () => {
  const columns = Array.from({ length: 28 }, (_, index) => `column ${index + 1}`);
  const files = new Map([["/wide.txt", new TextEncoder().encode(columns.join("\t"))]]);
  const result = await runSofficeCli(["--convert-to", "xlsx", "/wide.txt"], files);
  assert.equal(result.exitCode, 0, result.stderr);
  const engine = createEngine({ formats: [xlsxFormat] });
  try {
    const book = await engine.readWorkbook({ kind: "stream", filename: "wide.xlsx", source: [files.get("/wide.xlsx")!] }, {}, { signal: new AbortController().signal });
    assert.deepEqual(book.sheets[0]!.cells.map(cell => [cell.column, { ...cell.value }]), columns.map((value, column) => [column, { kind: "string", value }]));
  } finally { await engine.dispose(); }
});
