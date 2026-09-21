import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const field of ["gridBefore", "gridAfter", "gridSpan"])
for (const raw of ["0", "-000", " &#x9;+002&#xA; ", "", " &#x9; ", "1e0", "0x1", "1.0", "+", "-1", "&#xA0;1", "1&#x2003;", "9007199254740992"])
for (const route of ["model", "sdk", "cli"])
it(`table native count boundaries; strict=${strict}; ${field}; ${raw}; ${route}`, async () => {
  const good = raw.includes("002") || field !== "gridSpan" && ["0", "-000"].includes(raw);
  const count = raw.includes("002") ? 2 : 0;
  const before = field === "gridBefore" && good ? count : 0, after = field === "gridAfter" && good ? count : 0;
  const span = field === "gridSpan" && good ? count : 1, columns = before + after + span;
  const input = await textFixture(`<w:tbl><w:tblGrid>${'<w:gridCol w:w="720"/>'.repeat(columns)}</w:tblGrid><w:tr><w:trPr>${field === "gridSpan" ? "" : `<w:${field} w:val="${raw}"/>`}</w:trPr><w:tc><w:tcPr>${field === "gridSpan" ? `<w:gridSpan w:val="${raw}"/>` : ""}</w:tcPr><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`, {}, strict);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
  if (route === "model") {
    const inspect = async () => {
      const table = (await api.Document(input, textContext)).tables[0]!;
      expect(table.rows.at(0).grid_cols_before).toBe(before); expect(table.rows.at(0).grid_cols_after).toBe(after);
      expect(table.cell(0, before).grid_span).toBe(span); expect(table.row_cells(0)).toHaveLength(span);
      for (let col = before; col < before + span; col++) expect(table.cell(0, col)).toBe(table.cell(0, before));
    };
    if (good) await inspect(); else await expect(inspect()).rejects.toMatchObject({ code: "invalid-package" });
  } else if (route === "sdk") {
    const inspect = api.inspectDocumentTable(input, { table: 1 }, textContext);
    if (!good) await expect(inspect).rejects.toMatchObject({ code: "invalid-package" });
    else { const details = (await inspect).item.details; expect(details.omitted).toEqual([{ row: 1, before, after }]); expect(details.cells).toMatchObject([{ column: before + 1, columnSpan: span, text: "Owner" }]); expect(details.cells).toHaveLength(1); }
  } else {
    const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["tables", "get", "/input", "--table", "1", "--json"].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } });
    const json = JSON.parse(volume.readFileSync("/out", "utf8") as string);
    expect(result.exitCode).toBe(good ? 0 : 1);
    if (good) { expect(json.data.item.details.omitted).toEqual([{ row: 1, before, after }]); expect(json.data.item.details.cells).toMatchObject([{ column: before + 1, columnSpan: span }]); }
    else { expect(json.ok).toBe(false); expect(json.errors[0].code).toBe("invalid-package"); }
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
