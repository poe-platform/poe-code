import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process"])
for (const field of ["gridBefore", "gridAfter", "gridSpan"] as const)
for (const raw of ["+001", " &#x9;+001&#xA; "])
for (const route of ["model", "sdk", "cli"])
it(`table ${field} admits XML integer lexical forms without rewriting storage; strict=${strict}; ${carrier}; ${raw}; ${route}`, async () => {
  const wrap = (value: string) => carrier === "direct" ? value : carrier === "process" ? `<f:pass>${value}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? value : '<f:keep stamp="inert"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? value : '<f:keep stamp="inert"/>'}</mc:Fallback></mc:AlternateContent>`;
  const before = field === "gridBefore" ? 1 : 0, after = field === "gridAfter" ? 1 : 0;
  const property = wrap(`<w:${field} w:val="${raw}"/>`);
  const input = await textFixture(`<w:tbl xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:count" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:tblPr><!--table--><?owner retain?></w:tblPr><w:tblGrid>${'<w:gridCol w:w="1440"/>'.repeat(1 + before + after)}</w:tblGrid><w:tr><w:trPr>${field === "gridSpan" ? "" : property}</w:trPr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1440"/>${field === "gridSpan" ? property : ""}</w:tcPr><w:p><w:r><w:t>Original é 海</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/>`, {}, strict);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
  const stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  const cli = async (args: string[]) => api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: args.map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } });
  const coordinate = before ? "B1" : "A1";
  if (route === "model") {
    const doc = await api.Document(input, textContext), table = doc.tables[0]!;
    expect(table.rows.at(0).grid_cols_before).toBe(before); expect(table.rows.at(0).grid_cols_after).toBe(after);
    expect(table.cell(0, before).grid_span).toBe(1); expect(table.row_cells(0)).toHaveLength(1);
    if (before || after) expect(() => table.cell(0, before ? 0 : 1)).toThrow(api.BoundsError);
    table.cell(0, before).text = "Updated é 海"; await doc.save(stdout);
  } else {
    if (route === "sdk") {
      const details = (await api.inspectDocumentTable(input, { table: 1 }, textContext)).item.details;
      expect(details.omitted).toEqual([{ row: 1, before, after }]); expect(details.cells).toMatchObject([{ column: before + 1, columnSpan: 1, text: "Original é 海" }]); expect(details.cells).toHaveLength(1);
      await api.editDocumentTables(input, { operation: "tables.set", options: { table: 1, cell: coordinate, text: "Updated é 海", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout });
    } else {
      expect((await cli(["tables", "get", "/input", "--table", "1", "--json"])).exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
      const details = JSON.parse(volume.readFileSync("/out", "utf8") as string).data.item.details;
      expect(details.omitted).toEqual([{ row: 1, before, after }]); expect(details.cells).toMatchObject([{ column: before + 1, columnSpan: 1, text: "Original é 海" }]); expect(details.cells).toHaveLength(1);
      volume.writeFileSync("/out", ""); expect((await cli(["tables", "set", "/input", "--table", "1", "--cell", coordinate, "--text", "Updated é 海", "--output", "-"])).exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
    }
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), original = readPackage(input), current = readPackage(output);
  for (const [name, bytes] of original) if (name !== "word/document.xml") expect(current.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(current.get("word/document.xml"));
  expect(xml).toContain(`<w:${field} w:val="${raw}"/>`); expect(xml).toContain('<!--table--><?owner retain?>');
  if (carrier === "choice" || carrier === "fallback") expect(xml).toContain('<f:keep stamp="inert"/>');
  const table = (await api.Document(output, textContext)).tables[0]!;
  expect(table.cell(0, before).text).toBe("Updated é 海"); expect(table.rows.at(0).grid_cols_before).toBe(before); expect(table.rows.at(0).grid_cols_after).toBe(after);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
