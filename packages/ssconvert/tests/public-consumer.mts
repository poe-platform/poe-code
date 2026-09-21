import { createEngine, readXlsx, createXlsxWriter, referenceText, exportOptionPairs,
  type Workbook, type CapabilityContext, type ConversionRequest, type EngineConfig } from "@poe-code/ssconvert";
import { readXlsx as rootReadXlsx } from "poe-code/ssconvert";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 10, sheets: 2, operations: 30 } };
const original: Workbook = { sheets: [{ id: "s", name: "Consumer", cells: [
  { row: 0, column: 0, value: { kind: "string", value: "Public consumer" } }
] }] };
const bytes = await createXlsxWriter("2008")(original, [], context);
const book: Workbook = await readXlsx(bytes, context);
if (book.sheets[0]?.cells[0]?.value.kind !== "string" || rootReadXlsx !== readXlsx)
  throw new Error("Public codec consumer failed");
if (!referenceText.help || [...exportOptionPairs("sheet=Consumer")].length !== 1)
  throw new Error("Public metadata consumer failed");
const config: EngineConfig = { codecs: [], limits: context.limits, environment: context.environment };
const request: ConversionRequest = { input: { kind: "stream", source: [bytes] },
  destination: { kind: "stream", sink: { async write() {} } },
  importType: "Gnumeric_Excel:xlsx", exportType: "Gnumeric_Excel:xlsx2" };
const engine = createEngine(config);
try { if ((await engine.convert(request, context)).exitCode !== 0) throw new Error("Public engine consumer failed"); }
finally { await engine.dispose(); }
