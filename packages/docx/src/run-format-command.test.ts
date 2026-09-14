import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine, formatDocumentRuns, getDocxDiscovery, parseDocxArguments } from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

it("executes the same formatting operation through CLI flags and the SDK", async () => {
  const bytes = await textFixture(paragraph("Coastal survey"));
  const volume = Volume.fromJSON({ "/work/input.docx": Buffer.from(bytes) });
  const args = ["runs", "set", "input.docx", "--paragraph", "1", "--run", "1", "--bold", "false", "--underline", "DOUBLE", "--size", "11.5pt", "--theme-color", "ACCENT_2", "--baseline", "superscript", "--dry-run", "--json"];
  let stdout = "", stderr = "";
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: args.map(a => new TextEncoder().encode(a)), cwd: "/work", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect(result.exitCode).toBe(0);
  const data = await formatDocumentRuns(bytes, { paragraph: 1, run: 1, bold: false, underline: { enum: "WD_UNDERLINE", name: "DOUBLE" }, size: { value: 11.5, unit: "pt" }, themeColor: { enum: "MSO_THEME_COLOR", name: "ACCENT_2" }, baseline: "superscript", dryRun: true, json: true }, { ...textContext, encoding: { order: "input", compression: "store" } });
  expect(JSON.parse(stdout)).toMatchObject({ version: 1, operation: "runs.set", ok: true, data, affected: 1, errors: [], warnings: [] });
  expect(stderr).toBe("");
  expect(volume.readFileSync("/work/input.docx")).toEqual(Buffer.from(bytes));
});

it("advertises formatting support and its limits through help, schema and capabilities", () => {
  const discovery = (...args: string[]) => getDocxDiscovery(parseDocxArguments(args.map(a => new TextEncoder().encode(a))))!;
  expect(discovery("schema", "runs", "set").data).toMatchObject({ operations: [{ id: "runs.set", support: "edit", result: { oneOf: [{ properties: { affected: { type: "integer" }, data: { properties: { changes: { items: { properties: { kind: { const: "format" } } } } } } } }, {}] } }] });
  expect(discovery("help", "runs", "set").human).toContain("null removes");
  expect(discovery("capabilities").data).toMatchObject({ features: expect.arrayContaining([{ id: "F12", level: "edit", subsets: expect.any(Array), detected: null }]) });
});

it.each([["--size", "0.1pt"], ["--theme-color", "NOT_THEME_COLOR"], ["--baseline", "floating"]])("rejects invalid formatting without reading input: %j", async flags => {
  let reads = 0, stdout = "";
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["runs", "set", "input.docx", "--paragraph", "1", "--run", "1", ...flags, "--dry-run", "--json"].map(a => new TextEncoder().encode(a)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile() { reads++; return new Uint8Array(); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(2);
  expect(reads).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({ ok: false, affected: 0, errors: [{ code: "usage" }] });
});
