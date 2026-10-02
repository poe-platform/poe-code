import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, createDocxInspectionCommandEngine, editDocumentTables, parseDocumentXml, readArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
for (const strict of [false, true]) for (const route of ["sdk", "cli"] as const)
it.each(["0", "false", "off", "1", "true", "on"])(`F19 repeated-header XML whitespace ${route} strict=${strict} %s`, async value => {
  const cell = '<w:tc><w:tcPr><w:tcW w:w="900" w:type="dxa"/></w:tcPr><w:p/></w:tc>';
  const input = await textFixture(`<w:tbl><w:tblGrid><w:gridCol w:w="900"/></w:tblGrid><w:tr><w:trPr><w:tblHeader w:val="&#9; ${value} &#10;"/></w:trPr>${cell}</w:tr><w:tr>${cell}</w:tr></w:tbl>`, {}, strict);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" }), stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  const reject = value === "on" || value === "off";
  if (route === "sdk") {
    const result = editDocumentTables(input, { operation: "tables.rows.add", options: { table: 1, index: 1, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout });
    if (reject) await expect(result).rejects.toMatchObject({ code: "unsupported-edit" });
    else await result;
  }
  else {
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["tables", "rows", "add", "/input", "--table", "1", "--index", "1", "--output", "-"].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } });
    expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(reject ? 1 : 0);
    if (reject) expect(volume.readFileSync("/err", "utf8")).toContain("unsupported-edit");
  }
  if (reject) { expect(volume.readFileSync("/out")).toHaveLength(0); expect(volume.readFileSync("/input")).toEqual(Buffer.from(input)); return; }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), doc = await Document(output, textContext);
  expect(doc.tables[0]!.rows.length).toBe(3);
  const main = (await readArchive(output, textContext)).members.find(m => m.name === "word/document.xml")!;
  const root = parseDocumentXml(main.bytes).root, rows = root.children[0]!.children[0]!.children.filter(n => n.localName === "tr");
  const flag = rows[0]!.children.find(n => n.localName === "trPr")?.children.find(n => n.localName === "tblHeader");
  expect(flag !== undefined).toBe(["1", "true", "on"].includes(value));
  expect(new TextDecoder().decode(main.bytes)).toContain(`w:val="&#9; ${value} &#10;"`);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
