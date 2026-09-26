import { expect, it } from "vitest";
import { defaultLimits, execute, run, type InvocationContext } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { SettingsAdmission } from "./settings-admission.js";
import { createGzipCompressionProvider } from "./io/compression.js";
import { readCsv } from "./csv.js";
import { castValue } from "./table/types.js";
import { utf8Codec } from "./codecs/utf8.js";
import { compilePythonSearch } from "./python-regex.js";
import { sqlOptions } from "./sql-options.js";
import { parseDatabaseUrl } from "./database-url.js";

it("disables every default resource limit", () => {
  expect(Object.values(defaultLimits).every(value => value === Infinity)).toBe(true);
});
it("admits long regex patterns and retains explicit regex work limits", () => {
  const pattern = "a".repeat(257);
  expect(compilePythonSearch(pattern, () => {}, Infinity, () => {})(pattern)).toBe(true);
  expect(() => compilePythonSearch(pattern, () => {}, 1, () => {})(pattern)).toThrow("work budget");
});
it("parses database URLs without an implicit size ceiling", () => {
  const database = "a".repeat(1024 * 1024);
  expect(parseDatabaseUrl(`sqlite:///${database}`).database).toBe(database);
});
it("parses SQL option collections without an implicit work ceiling", () => {
  expect(sqlOptions(Array.from({ length: 100_001 }, () => ["value", 1] as const))).toEqual({ value: 1 });
  let nested: unknown = sqlOptions([["value", "[".repeat(101) + "1" + "]".repeat(101)]]).value;
  for (let depth = 0; depth < 101; depth++) nested = (nested as unknown[])[0];
  expect(nested).toBe(1);
});
it("reads fields beyond the former implicit CSV ceiling and retains explicit limits", () => {
  const value = "x".repeat(131073);
  expect([...readCsv(`${value}\n`)]).toEqual([{ cells: [value], line: 1 }]);
  expect([...readCsv(`${value}\n`, { fieldLimit: Infinity })]).toEqual([{ cells: [value], line: 1 }]);
  expect(() => [...readCsv("long\n", { fieldLimit: 3 })]).toThrow("FieldSizeLimitError");
});
it.each([["SDK", undefined], ["SDK", Infinity], ["CLI", undefined], ["CLI", Infinity]] as const)("passes unbounded field settings through the %s: %s", async (route, field_size_limit) => {
  const value = "x".repeat(131073), output: string[] = [];
  const context: InvocationContext = {
    cwd: "/", env: {}, limits: defaultLimits, signal: new AbortController().signal,
    fs: { async readFile() { throw new Error("unexpected file read"); }, async writeFile() { throw new Error("unexpected file write"); } },
    stdin: (async function* () { yield new TextEncoder().encode(`name\n${value}\n`); })(), stdinIsDefault: false,
    stdout: { async write(bytes) { output.push(new TextDecoder().decode(bytes)); } },
    stderr: { async write(bytes) { throw new Error(new TextDecoder().decode(bytes)); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    codecs: [utf8Codec], compression: [], databases: [],
    locale: { profile: "C", timezone: "UTC", formatNumber() { throw new Error("unexpected locale"); } },
    clock: { now: () => 0 }, registerCleanup() {}
  };
  const result = route === "SDK"
    ? await run({ command: "csvcut", settings: { columns: "1", ...(field_size_limit === undefined ? {} : { field_size_limit }) } }, context)
    : await execute("csvcut", { ...context, argv: new OwnedArguments(["-c", "1", ...(field_size_limit === undefined ? [] : ["-z", "Infinity"])].map(argument => new TextEncoder().encode(argument)), defaultLimits) });
  expect(result).toBe(0);
  expect(output.join("")).toBe(`name\n${value}\n`);
});
it.each([{}, { maxDecimalDigits: Infinity, maxDecimalExponent: Infinity }])("casts decimals without an implicit digit or exponent ceiling: %j", options => {
  expect(castValue("Number", "1".repeat(10001), options)).toMatchObject({ kind: "decimal" });
  expect(castValue("Number", "1e10001", options)).toEqual({ kind: "decimal", value: "1E+10001" });
  expect(() => castValue("Number", "1234", { maxDecimalDigits: 3 })).toThrow("Decimal admission budget");
  expect(() => castValue("Number", "1e4", { maxDecimalExponent: 3 })).toThrow("Decimal admission budget");
});
it("admits explicit Infinity through SDK invocation and bigint settings", async () => {
  const limits = Object.fromEntries(Object.keys(defaultLimits).map(key => [key, Infinity])) as unknown as typeof defaultLimits;
  const context = { limits, signal: new AbortController().signal, env: {}, terminal: {}, codecs: [], compression: [], databases: [] } as unknown as InvocationContext;
  await expect(run({ command: "unknown" } as never, context)).rejects.toThrow("Unknown csvkit executable");
  expect(new OwnedArguments([new Uint8Array([1])], limits).byteLength).toBe(1);
  expect(() => new SettingsAdmission(limits, context.signal).admit(123n)).not.toThrow();
  let nested: unknown = true;
  for (let index = 0; index < 300; index++) nested = { child: nested };
  expect(() => new SettingsAdmission(limits, context.signal).admit(nested)).not.toThrow();
  const admission = new SettingsAdmission({ ...limits, maxArgumentBytes: 2 }, context.signal);
  expect(() => admission.admit(123n)).toThrow("argument byte budget");
});
it("admits unlimited gzip members while preserving finite limits", async () => {
  const codec = { memberAdmission: true as const, CodecReader: class {
    async chunk() { return new Uint8Array([1]); }
    restore() {}
    async close() {}
  }, async *codec(_reader: unknown, options: { onMember(): void }) {
    options.onMember(); options.onMember(); yield new Uint8Array([2]);
  } };
  const provider = createGzipCompressionProvider(codec);
  const read = async (maxArchiveMembers: number) => {
    const chunks = [];
    for await (const chunk of provider.decode((async function* () {})(), new AbortController().signal, { maxArchiveMembers })) chunks.push(chunk);
    return chunks;
  };
  await expect(read(Infinity)).resolves.toEqual([new Uint8Array([2])]);
  await expect(read(1)).rejects.toThrow("member budget");
});
