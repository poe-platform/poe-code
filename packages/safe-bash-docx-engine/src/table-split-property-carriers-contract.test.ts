import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process"])
for (const route of ["sdk", "cli"])
it(`split rewrites active span properties and retains their carriers; strict=${strict}; ${carrier}; ${route}`, async () => {
  const wrap = (s: string) => carrier === "direct" ? s : carrier === "process" ? `<f:pass>${s}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? s : '<f:keep stamp="inert"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? s : '<f:keep stamp="inert"/>'}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture(`<w:tbl xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:split-property" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:tblPr><!--table--><?owner retain?></w:tblPr><w:tblGrid><w:gridCol w:w="720"/><w:gridCol w:w="720"/></w:tblGrid>${[0, 1].map(row => `<w:tr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1440"/>${wrap('<w:gridSpan w:val="2"/>')}${wrap(`<w:vMerge w:val="${row ? "continue" : "restart"}"/>`)}<w:shd w:fill="ABCDEF"/></w:tcPr><w:p>${row ? "" : '<w:r><w:t>Owner é 海</w:t></w:r>'}</w:p></w:tc></w:tr>`).join("")}</w:tbl>`, {}, strict);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" }), stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  if (route === "sdk") await api.editDocumentTables(input, { operation: "tables.split", options: { table: 1, cell: "B2", rows: 2, cols: 2, distribute: "anchor", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout });
  else { const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["tables", "split", "/input", "--table", "1", "--cell", "B2", "--rows", "2", "--cols", "2", "--distribute", "anchor", "--output", "-"].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } }); expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0); }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), table = (await api.Document(output, textContext)).tables[0]!;
  expect(table.cell(0, 0).text).toBe("Owner é 海");
  for (const r of [0, 1]) for (const c of [0, 1]) { expect(table.cell(r, c).grid_span).toBe(1); expect(table.cell(r, c).width?.twips).toBe(720); if (r || c) { expect(table.cell(r, c).text).toBe(""); expect(table.cell(r, c)).not.toBe(table.cell(0, 0)); } }
  const before = readPackage(input), after = readPackage(output); for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(after.get("word/document.xml")); expect(xml).toContain('<!--table--><?owner retain?>');
  // Inert carrier content stays once with each original physical cell.
  // Generated cells inherit active native formatting without cloning unknown semantics.
  if (carrier === "choice" || carrier === "fallback") expect(xml.split('<f:keep stamp="inert"/>')).toHaveLength(5);
  const root = api.parseDocumentXml(after.get("word/document.xml")!, {}).root, pending = [root];
  const shading: api.XmlElement[] = []; while (pending.length) { const n = pending.pop()!; if (n.localName === "shd" && n.namespace === root.namespace) shading.push(n); pending.push(...n.children); }
  expect(shading).toHaveLength(4); expect(shading.every(n => n.attributes.some(a => a.namespace === root.namespace && a.localName === "fill" && a.value === "ABCDEF"))).toBe(true);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
