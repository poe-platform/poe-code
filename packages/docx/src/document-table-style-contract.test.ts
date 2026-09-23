import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value), ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "shell"] as const)
for (const choice of ["omitted", "null", "name", "owner", "missing", "wrong-type", "false", "zero"] as const)
it(`${route} applies Document table style ${choice} with atomic ownership; ${kind} strict=${strict}`, async () => {
  const { input: initial } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Style ledger</w:t></w:r></w:p><w:sectPr/>');
  const seed = await api.Document(initial, textContext), grid = seed.styles.add_style("Survey Grid", api.WD_STYLE_TYPE.TABLE), wrong = seed.styles.add_style("Survey Run", api.WD_STYLE_TYPE.CHARACTER);
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }); await seed.save({ async write(bytes) { memory.appendFileSync("/input", bytes); } });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = readPackage(input), valid = ["omitted", "null", "name", "owner"].includes(choice), named = ["name", "owner"].includes(choice);
  const styleName = choice === "wrong-type" ? wrong.name : grid.name, value = choice === "omitted" ? undefined : choice === "null" ? null : choice === "owner" ? ref("style") : choice === "missing" ? "Missing Grid" : choice === "false" ? false : choice === "zero" ? 0 : styleName;
  const operations = [
    { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.__getitem__.call", receiver: ref("styles"), arguments: { key: "Survey Grid" }, resultHandle: "style" },
    { operation: "model.document.Document.add_table.call", receiver: ref("document"), arguments: { rows: 1, cols: 2, ...(choice === "omitted" ? {} : { style: value }) }, resultHandle: "table" },
    { operation: "model.table.Table.style.get", receiver: ref("table"), arguments: {}, resultHandle: "applied" },
    { operation: "model.styles.style._TableStyle.name.get", receiver: ref("applied"), arguments: {} }
  ];
  const expected = named ? "Survey Grid" : "Normal Table", context = { ...textContext, encoding: { order: "input", compression: "store" } as const }, sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const doc = await api.Document(input, context), prior = doc.part.package.parts.map(p => [String(p.partname), p.blob]);
    const style = choice === "owner" ? doc.styles.at("Survey Grid") : value;
    const create = () => (doc.add_table as unknown as (rows: number, cols: number, style?: unknown) => api.Table)(1, 2, style);
    if (valid) { const table = create(); expect(table.style?.name).toBe(expected); await doc.save(sink); }
    else { expect(create).toThrow(); expect(doc.tables.length).toBe(0); expect(doc.part.package.parts.map(p => [String(p.partname), p.blob])).toEqual(prior); }
  } else if (route === "sdk") {
    const pending = api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: sink });
    if (valid) expect((await pending).results.at(-1)!.data).toBe(expected); else { await expect(pending).rejects.toBeDefined(); expect(memory.readFileSync("/output")).toHaveLength(0); }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", enc("retained")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json"); if (valid) { expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe(expected); memory.writeFileSync("/output", await fs.readFile("/output")); } else { expect(result.exitCode).not.toBe(0); expect(await fs.readFile("/output")).toEqual(enc("retained")); } expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  if (valid) {
    const saved = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer)), tree = xmlStructure(saved.get("word/document.xml")!), walk = (n: typeof tree): typeof tree[] => [n, ...n.children.flatMap(c => typeof c === "string" ? [] : walk(c))], styles = walk(tree).filter(n => n.name.endsWith("}tblStyle"));
    expect(styles).toHaveLength(named ? 1 : 0); if (named) expect(Object.values(styles[0]!.attributes)).toEqual([grid.style_id]);
    for (const [name, bytes] of before) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
it(`rejects a foreign Document table style without creating a table; ${kind} strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, "<w:p/><w:sectPr/>");
  const doc = await api.Document(input, textContext), foreign = (await api.Document(input, textContext)).styles.add_style("Foreign Grid", api.WD_STYLE_TYPE.TABLE), before = doc.part.package.parts.map(p => [String(p.partname), p.blob]);
  expect(() => (doc.add_table as unknown as (rows: number, cols: number, style: unknown) => api.Table)(1, 1, foreign)).toThrow(); expect(doc.tables.length).toBe(0); expect(doc.part.package.parts.map(p => [String(p.partname), p.blob])).toEqual(before);
});
