import { expect, it } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { createEngine } from "./core.js";

it("the composable engine has no implicit file formats", async () => {
  const engine = createEngine();
  try {
    expect(engine.listServices("read")).toEqual([]);
    expect(engine.listServices("write")).toEqual([]);
  } finally { await engine.dispose(); }
});

it("a CSV-only application excludes other file readers, cryptography and PDF rendering", async () => {
  const result = await build({
    stdin: {
      contents: 'import { createEngine } from "./core.ts"; import { csvFormat } from "./formats/csv.ts"; globalThis.engine = createEngine({ formats: [csvFormat] });',
      resolveDir: fileURLToPath(new URL(".", import.meta.url))
    },
    bundle: true, platform: "browser", format: "esm", write: false, metafile: true, logLevel: "silent"
  });
  const included = Object.values(result.metafile!.outputs).flatMap(output =>
    Object.entries(output.inputs).filter(([, value]) => value.bytesInOutput > 0).map(([name]) => name));
  const unwanted = ["/codecs/xlsx.ts", "/codecs/biff.ts", "/codecs/odf.ts", "/codecs/gnumeric.ts", "/codecs/lotus.ts",
    "/spreadsheet-format-xlsx/", "/spreadsheet-format-xls/", "/spreadsheet-format-ods/", "/pdf-lib/", "/fontkit/", "/@noble/ciphers/"];
  expect(included.filter(name => unwanted.some(part => name.includes(part)))).toEqual([]);
  expect(result.outputFiles[0]!.text).toContain("stf_csv");
});

it("an XLSX and CSV application excludes ODS, BIFF and print rendering", async () => {
  const result = await build({
    stdin: {
      contents: 'import { createEngine } from "./core.ts"; import { csvFormat } from "./formats/csv.ts"; import { xlsxFormat } from "./formats/xlsx.ts"; globalThis.engine = createEngine({ formats: [csvFormat, xlsxFormat] });',
      resolveDir: fileURLToPath(new URL(".", import.meta.url))
    },
    bundle: true, platform: "browser", format: "esm", write: false, metafile: true, logLevel: "silent"
  });
  const included = Object.values(result.metafile!.outputs).flatMap(output =>
    Object.entries(output.inputs).filter(([, value]) => value.bytesInOutput > 0).map(([name]) => name));
  expect(included.some(name => name.includes("/spreadsheet-format-xlsx/"))).toBe(true);
  expect(included.some(name => name.includes("/spreadsheet-format-csv/"))).toBe(true);
  expect(included.filter(name => ["/spreadsheet-format-xls/", "/spreadsheet-format-ods/", "/pdf-lib/", "/fontkit/", "/@noble/ciphers/"]
    .some(part => name.includes(part)))).toEqual([]);
});

it("an AST-only application has no engine, format or external runtime dependencies", async () => {
  const result = await build({
    stdin: {
      contents: 'export { snapshotWorkbook, updateWorkbook, parseA1 } from "@poe-code/spreadsheet-ast";',
      resolveDir: fileURLToPath(new URL(".", import.meta.url))
    },
    bundle: true, platform: "browser", format: "esm", write: false, metafile: true, logLevel: "silent"
  });
  const outputs = Object.values(result.metafile!.outputs);
  expect(outputs.flatMap(output => output.imports)).toEqual([]);
  const contributing = outputs.flatMap(output => Object.entries(output.inputs)
    .filter(([, value]) => value.bytesInOutput > 0).map(([name]) => name));
  expect(contributing.filter(name => !name.includes("/spreadsheet-ast/") && name !== "<stdin>")).toEqual([]);
});

it("an ODS-only application does not obtain shared rich-text helpers from XLSX", async () => {
  const result = await build({
    stdin: {
      contents: 'import { createEngine } from "./core.ts"; import { odsFormat } from "./formats/ods.ts"; globalThis.engine = createEngine({ formats: [odsFormat] });',
      resolveDir: fileURLToPath(new URL(".", import.meta.url))
    },
    bundle: true, platform: "browser", format: "esm", write: false, metafile: true, logLevel: "silent"
  });
  const included = Object.values(result.metafile!.outputs).flatMap(output =>
    Object.entries(output.inputs).filter(([, value]) => value.bytesInOutput > 0).map(([name]) => name));
  expect(included.some(name => name.includes("/spreadsheet-format-ods/"))).toBe(true);
  expect(included.filter(name => ["/spreadsheet-format-xlsx/", "/spreadsheet-format-xls/", "/spreadsheet-format-csv/", "/pdf-lib/", "/fontkit/"]
    .some(part => name.includes(part)))).toEqual([]);
});

it("a SpreadsheetML application uses an independent format owner without shell commands or competing formats", async () => {
  const result = await build({
    stdin: {
      contents: 'import { createEngine } from "./core.ts"; import { spreadsheetmlFormat } from "./formats/spreadsheetml.ts"; globalThis.engine = createEngine({ formats: [spreadsheetmlFormat] });',
      resolveDir: fileURLToPath(new URL(".", import.meta.url))
    },
    bundle: true, platform: "browser", format: "esm", write: false, metafile: true, logLevel: "silent"
  });
  const included = Object.values(result.metafile!.outputs).flatMap(output =>
    Object.entries(output.inputs).filter(([, value]) => value.bytesInOutput > 0).map(([name]) => name));
  expect(included.some(name => name.includes("/spreadsheet-format-spreadsheetml/"))).toBe(true);
  expect(included.filter(name => ["/safe-bash-command-ssconvert/", "/spreadsheet-format-xlsx/", "/spreadsheet-format-xls/",
    "/spreadsheet-format-csv/", "/spreadsheet-format-ods/", "/pdf-lib/", "/fontkit/"]
    .some(part => name.includes(part)))).toEqual([]);
  expect(result.outputFiles[0]!.text).toContain("excel_xml");
});

it("an HTML spreadsheet application excludes shell commands, other formats and document exporters", async () => {
  const result = await build({
    stdin: {
      contents: 'import { createEngine } from "./core.ts"; import { htmlFormat } from "./formats/html.ts"; globalThis.engine = createEngine({ formats: [htmlFormat] });',
      resolveDir: fileURLToPath(new URL(".", import.meta.url))
    },
    bundle: true, platform: "browser", format: "esm", write: false, metafile: true, logLevel: "silent"
  });
  const included = Object.values(result.metafile!.outputs).flatMap(output =>
    Object.entries(output.inputs).filter(([, value]) => value.bytesInOutput > 0).map(([name]) => name));
  expect(included.some(name => name.includes("/spreadsheet-format-html/"))).toBe(true);
  expect(included.filter(name => ["/safe-bash-command-ssconvert/", "/spreadsheet-format-xlsx/", "/spreadsheet-format-xls/",
    "/spreadsheet-format-csv/", "/spreadsheet-format-ods/", "/spreadsheet-format-spreadsheetml/", "/pdf-lib/", "/fontkit/"]
    .some(part => name.includes(part)))).toEqual([]);
  expect(result.outputFiles[0]!.text).toContain("html40frag");
  for (const marker of ["createLatexWriter", "writeRoff"]) expect(result.outputFiles[0]!.text).not.toContain(marker);
});

it("a DBF application owns its reader without shell commands or competing formats", async () => {
  const result = await build({
    stdin: {
      contents: 'import { createEngine } from "./core.ts"; import { dbfFormat } from "./formats/dbf.ts"; globalThis.engine = createEngine({ formats: [dbfFormat] });',
      resolveDir: fileURLToPath(new URL(".", import.meta.url))
    },
    bundle: true, platform: "browser", format: "esm", write: false, metafile: true, logLevel: "silent"
  });
  const included = Object.values(result.metafile!.outputs).flatMap(output =>
    Object.entries(output.inputs).filter(([, value]) => value.bytesInOutput > 0).map(([name]) => name));
  expect(included.some(name => name.includes("/spreadsheet-format-dbf/"))).toBe(true);
  expect(included.filter(name => ["/safe-bash-command-ssconvert/", "/spreadsheet-format-xlsx/", "/xlsx-ast/", "/spreadsheet-format-xls/",
    "/spreadsheet-format-csv/", "/spreadsheet-format-ods/", "/spreadsheet-format-spreadsheetml/", "/spreadsheet-format-html/",
    "/pdf-lib/", "/fontkit/"].some(part => name.includes(part)))).toEqual([]);
  expect(result.outputFiles[0]!.text).toContain("Gnumeric_xbase");
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
});

it.each([
  ["CSV", false],
  ["CSV and XLSX", true]
])('a %s command excludes unselected codecs and rendering', async (_name, includeXlsx) => {
  const formats = includeXlsx ? "csvFormat, xlsxFormat" : "csvFormat";
  const result = await build({
    stdin: {
      contents: `import { createSsconvertCommand, createSsconvertCommands, ssconvertCommands } from "./commands.ts";
        import { csvFormat } from "./formats/csv.ts";
        ${includeXlsx ? 'import { xlsxFormat } from "./formats/xlsx.ts";' : ''}
        globalThis.commands = [createSsconvertCommand({ formats: [${formats}] }),
          createSsconvertCommands({ formats: [${formats}] }), ssconvertCommands({ formats: [${formats}] })];`,
      resolveDir: fileURLToPath(new URL(".", import.meta.url))
    },
    bundle: true, platform: "browser", format: "esm", write: false, metafile: true, logLevel: "silent"
  });
  const included = Object.values(result.metafile!.outputs).flatMap(output =>
    Object.entries(output.inputs).filter(([, value]) => value.bytesInOutput > 0).map(([name]) => name));
  expect(included.some(name => name.includes("/spreadsheet-format-csv/"))).toBe(true);
  expect(included.some(name => name.includes("/spreadsheet-format-xlsx/"))).toBe(includeXlsx);
  expect(included.filter(name => ["/spreadsheet-format-xls/", "/spreadsheet-format-ods/", "/spreadsheet-format-html/",
    "/spreadsheet-format-dbf/", "/spreadsheet-format-spreadsheetml/", "/pdf-lib/", "/fontkit/", "/@noble/ciphers/",
    "/codecs/providers/", "/rendering/print/"].some(part => name.includes(part)))).toEqual([]);
});
