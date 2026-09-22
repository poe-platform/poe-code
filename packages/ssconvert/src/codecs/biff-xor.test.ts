import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { decryptBiffRecords } from "./biff-encryption.js";
import { writeCfb } from "./biff-write-binary.js";
import { Binary, readBiffRecords } from "./biff-binary.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
// Independently obfuscated MS-OFFCRYPTO vectors, recalculated by native Gnumeric.
const fixtures = [
  { revision: 7 as const, mode: "number", input: "0908100000050500bb0dcc0741000000060000002f00040059b30a9ae1000200e4044200020082e9310013001d876b9a1df1f125621e69966098eefe284a05e0001000e21ee305621e699660986e9404876b9ae0001000621e699660986e9404876b9ae21ee305e000100060986e9404876b9ae21ee305621e6996e000100004876b9ae21ee305621e699660986e94e0001000e21ee305621e699660986e9404876b9ae0001000621e699660986e9404876b9ae21ee305e000100060986e9404876b9ae21ee305621e6996e000100004876b9ae21ee305621e699660986e94e0001000e21ee305621e699660986e9404876b9ae0001000621e699660986e9404876b9ae21ee305e000100060986e9404876b9ae21ee305621e6996e000100004876b9ae21ee305621e699660986e94e0001000e21ee305621e699660986e9404876b9ae0001000621e699660986e9404876b9ae21ee305e000100060986e9404876b9ae21ee305621e6996e000100004876b9ae21ee305621e699660986e9485000b00920100009ae29eeaa92cb20a0000000908100000051000bb0dcc07410000000600000003020e001e699660796e9404876b9ae2b6eb0a000000" },
  { revision: 7 as const, mode: "formula", input: "0908100000050500bb0dcc0741000000060000002f00040059b30a9ae1000200e4044200020082e9310013001d876b9a1df1f125621e69966098eefe284a05e0001000e21ee305621e699660986e9404876b9ae0001000621e699660986e9404876b9ae21ee305e000100060986e9404876b9ae21ee305621e6996e000100004876b9ae21ee305621e699660986e94e0001000e21ee305621e699660986e9404876b9ae0001000621e699660986e9404876b9ae21ee305e000100060986e9404876b9ae21ee305621e6996e000100004876b9ae21ee305621e699660986e94e0001000e21ee305621e699660986e9404876b9ae0001000621e699660986e9404876b9ae21ee305e000100060986e9404876b9ae21ee305621e6996e000100004876b9ae21ee305621e699660986e94e0001000e21ee305621e699660986e9404876b9ae0001000621e699660986e9404876b9ae21ee305e000100060986e9404876b9ae21ee305621e6996e000100004876b9ae21ee305621e699660986e9485000b00920100009ae29eeaa92cb20a0000000908100000051000bb0dcc07410000000600000006001d00621e699681986e9404876b9d1316e305621e69968098adb104444b9a820a000000" },
  { revision: 7 as const, mode: "string", input: "0908100000050500bb0dcc0741000000060000002f00040059b30a9ae1000200e4044200020082e9310013001d876b9a1df1f125621e69966098eefe284a05e0001000e21ee305621e699660986e9404876b9ae0001000621e699660986e9404876b9ae21ee305e000100060986e9404876b9ae21ee305621e6996e000100004876b9ae21ee305621e699660986e94e0001000e21ee305621e699660986e9404876b9ae0001000621e699660986e9404876b9ae21ee305e000100060986e9404876b9ae21ee305621e6996e000100004876b9ae21ee305621e699660986e94e0001000e21ee305621e699660986e9404876b9ae0001000621e699660986e9404876b9ae21ee305e000100060986e9404876b9ae21ee305621e6996e000100004876b9ae21ee305621e699660986e94e0001000e21ee305621e699660986e9404876b9ae0001000621e699660986e9404876b9ae21ee305e000100060986e9404876b9ae21ee305621e6996e000100004876b9ae21ee305621e699660986e9485000b00920100009ae29eeaa92cb20a0000000908100000051000bb0dcc07410000000600000004022600876b9ae2ffe3c66236e5ba64b4a31800ab6f170fd30f012cb2057b2e146ad8e929a616ce50cc0a000000" },
  { revision: 8 as const, mode: "number", input: "0908100000060500bb0dcc0741000000060000002f000600000059b30a9ae1000200e404420002000ae03100140083e21ee3fa8d0c499660986e9404076bf0ced38de00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee385000c00d601000005629e699fccd6c20a0000000908100000061000bb0dcc07410000000600000003020e00986e9404666b9ae21ee30562b6610a000000" },
  { revision: 8 as const, mode: "formula", input: "0908100000060500bb0dcc0741000000060000002f000600000059b30a9ae1000200e404420002000ae03100140083e21ee3fa8d0c499660986e9404076bf0ced38de00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee385000c00d601000005629e699fccd6c20a0000000908100000061000bb0dcc07410000000600000006001d0060986e94e5876b9ae21ee3029316699660986e94e487a8bfe2ddc305020a000000" },
  { revision: 8 as const, mode: "string", input: "0908100000060500bb0dcc0741000000060000002f000600000059b30a9ae1000200e404420002000ae03100140083e21ee3fa8d0c499660986e9404076bf0ced38de00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee385000c00d601000005629e699fccd6c20a0000000908100000061000bb0dcc07410000000600000004022700e305621e8896a3986ebc88ab6fb62f92e7296693845b8c9c2038686a2516e6520eabaf9245d84f0a000000" },
  { revision: 8 as const, mode: "sst", input: "0908100000060500bb0dcc0741000000060000002f000600000059b30a9ae1000200e404420002000ae03100140083e21ee3fa8d0c499660986e9404076bf0ced38de00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3e00014009660986e9404876b9ae21ee305621e699660986ee00014009ae21ee305621e699660986e9404876b9ae21ee3fc0017004e9404874b9ae21e20056236e5ba64b4a31800ab6f170f3c0013001e2ee96650c5fa8dd6e290486ac5576e32ad2a85000c00080200001e69166091c2daa80a0000000908100000061000bb0dcc074100000006000000fd000a009660986e7504876b9ae20a000000" },
];
function bytes(hex: string): Uint8Array { return Uint8Array.from(hex.match(/../g)!, part => parseInt(part, 16)); }
it.each(fixtures)("imports default-password XOR BIFF$revision $mode", async ({ revision, mode, input }) => {
  const original = bytes(input), baseline = original.slice(), diagnostics: string[] = [];
  const book = await readBiff(original, { ...context, async diagnostic(value) { diagnostics.push(value.message); } });
  expect(original).toEqual(baseline);
  expect(book.sheets[0]!.name).toBe("Here");
  expect(diagnostics).toEqual([]);
  const expected = mode === "string" || mode === "sst" ? { kind: "string", value: "Ada and a long record boundary" } : { kind: "number", value: 42 };
  if (mode === "formula") expect(book.sheets[0]!.cells[0]!.formula).toBe("=41+1");
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual(expected);
  const output = await createBiffWriter(revision)(book, [], { ...context, async diagnostic(value) { diagnostics.push(value.message); } });
  expect(diagnostics).toEqual([]);
  expect(recalculateWorkbook(await readBiff(output, context), context, true).sheets[0]!.cells[0]!.value).toEqual(expected);
});
it("refuses wrong passwords, other encryption methods, and repeated declarations", async () => {
  for (const fixture of fixtures.filter(item => item.mode === "number")) {
    const original = bytes(fixture.input), pass = readBiffRecords(original, context).find(record => record.opcode === 0x2f)!;
    const altered = original.slice(); altered[pass.offset + 4 + (fixture.revision === 8 ? 4 : 2)]! ^= 1;
    await expect(readBiff(altered, context)).rejects.toThrow("encrypted Excel workbook");
    if (fixture.revision === 8) {
      const unsupported = original.slice(); unsupported[pass.offset + 4] = 1;
      await expect(readBiff(unsupported, context)).rejects.toThrow("encrypted Excel workbook");
    }
    const repeated = new Uint8Array(original.length + 4 + pass.data.bytes.length);
    repeated.set(original.subarray(0, pass.offset));
    repeated.set(original.subarray(pass.offset, pass.offset + 4 + pass.data.bytes.length), pass.offset);
    repeated.set(original.subarray(pass.offset), pass.offset + 4 + pass.data.bytes.length);
    await expect(readBiff(repeated, context)).rejects.toThrow("duplicate FILEPASS");
  }
});
it("admits decryption work before allocation and observes caller cancellation", async () => {
  const input = bytes(fixtures[0]!.input);
  await expect(readBiff(input, { ...context, limits: { ...context.limits, workbookWork: 0 } }))
    .rejects.toThrow("work limit");
  const controller = new AbortController(); controller.abort(new Error("cancelled XOR import"));
  await expect(readBiff(input, { ...context, signal: controller.signal })).rejects.toThrow("cancelled XOR import");
});

it("opens an original XOR stream through its CFB Workbook container", async () => {
  const stream = bytes(fixtures.find(item => item.revision === 8 && item.mode === "formula")!.input);
  const input = await writeCfb(new Map([["Workbook", stream]]), context), original = input.slice();
  const book = await readBiff(input, context);
  expect(input).toEqual(original);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
});
it("leaves all specification-exempt record payloads and framing untouched", () => {
  const pass = { opcode: 0x2f, offset: 0, data: new Binary(bytes("000059b30a9a")) };
  for (const opcode of [9, 0x209, 0x409, 0x809, 0x194, 0x195, 0xe1, 0x196, 0x138]) {
    const clear = { opcode, offset: 10, data: new Binary(bytes("1032547698badcfe")) }, records = [pass, clear];
    decryptBiffRecords(records, 8, context);
    expect(records[1]).toBe(clear);
    expect(records[1]!.data.bytes).toEqual(bytes("1032547698badcfe"));
  }
});
it("bounds XOR headers and the partially plaintext BoundSheet payload", () => {
  for (const input of ["0000", "000059b30a", "000059b30a9a00"])
    expect(() => decryptBiffRecords([{ opcode: 0x2f, offset: 0, data: new Binary(bytes(input)) }], 8, context)).toThrow("Invalid Excel BIFF");
  const records = [{ opcode: 0x2f, offset: 0, data: new Binary(bytes("000059b30a9a")) },
    { opcode: 0x85, offset: 10, data: new Binary(bytes("010203")) }];
  expect(() => decryptBiffRecords(records, 8, context)).toThrow("Invalid Excel BIFF");
});
it("checks decryption work before copying payload bytes", () => {
  const data = new Binary(bytes("1032547698badcfe")), copy = vi.spyOn(data.bytes, "slice");
  const records = [{ opcode: 0x2f, offset: 0, data: new Binary(bytes("000059b30a9a")) }, { opcode: 0x203, offset: 10, data }];
  expect(() => decryptBiffRecords(records, 8, { ...context, limits: { ...context.limits, workbookWork: 0 } })).toThrow("decryption work limit");
  expect(copy).not.toHaveBeenCalled();
  expect(records[1]!.data).toBe(data);
});
it("observes cancellation within a long record without publishing partial decoded bytes", () => {
  let checks = 0;
  const signal = { throwIfAborted() { if (++checks === 5) throw new Error("cancel inside XOR"); } } as AbortSignal;
  const data = new Binary(new Uint8Array(5000)), original = data.bytes.slice();
  const records = [{ opcode: 0x2f, offset: 0, data: new Binary(bytes("000059b30a9a")) }, { opcode: 0x203, offset: 10, data }];
  expect(() => decryptBiffRecords(records, 8, { ...context, signal })).toThrow("cancel inside XOR");
  expect(records[1]!.data).toBe(data);
  expect(data.bytes).toEqual(original);
});

it("publishes successful public-command conversion from encrypted input without altering its source", async () => {
  const input = bytes(fixtures.find(item => item.revision === 8 && item.mode === "formula")!.input);
  const volume = Volume.fromJSON({ "/target.csv": "untouched\n" }); volume.writeFileSync("/input.xls", input);
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits,
    filesystem: { cwd: "/", async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, value) { volume.writeFileSync(uri, value); } } });
  const stderr: Uint8Array[] = [];
  try {
    expect(await runCommand(["--recalc", "-T", "Gnumeric_stf:stf_csv", "/input.xls", "/target.csv"], engine,
      { signal: context.signal, stdout: { async write() {} }, stderr: { async write(value) { stderr.push(value); } } })).toMatchObject({ exitCode: 0 });
    expect(volume.readFileSync("/target.csv", "utf8")).toBe("42\n");
    expect(new Uint8Array(volume.readFileSync("/input.xls") as Uint8Array)).toEqual(input);
    expect(stderr).toEqual([]);
  } finally { await engine.dispose(); }
});
it("preserves existing public-command targets on password, algorithm, corruption and work refusals", async () => {
  const original = bytes(fixtures.find(item => item.revision === 8 && item.mode === "number")!.input);
  const pass = readBiffRecords(original, context).find(record => record.opcode === 0x2f)!;
  for (const mode of ["password", "algorithm", "corruption", "work"]) {
    const input = original.slice();
    if (mode === "password") input[pass.offset + 8]! ^= 1;
    if (mode === "algorithm") input[pass.offset + 4] = 1;
    const volume = Volume.fromJSON({ "/target.csv": "untouched\n" });
    volume.writeFileSync("/input.xls", mode === "corruption" ? input.subarray(0, input.length - 1) : input);
    const limits = mode === "work" ? { ...context.limits, workbookWork: 0 } : context.limits;
    let writes = 0;
    const engine = createEngine({ codecs: [], environment: context.environment, limits,
      filesystem: { cwd: "/", async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
        async write(uri, value) { writes++; volume.writeFileSync(uri, value); } } });
    const stdout: Uint8Array[] = [];
    try {
      expect(await runCommand(["--recalc", "-T", "Gnumeric_stf:stf_csv", "/input.xls", "/target.csv"], engine,
        { signal: context.signal, stdout: { async write(value) { stdout.push(value); } }, stderr: { async write() {} } })).toEqual({ exitCode: 1 });
      expect(writes).toBe(0);
      expect(volume.readFileSync("/target.csv", "utf8")).toBe("untouched\n");
      expect(Object.keys(volume.toJSON()).sort()).toEqual(["/input.xls", "/target.csv"]);
      expect(stdout).toEqual([]);
    } finally { await engine.dispose(); }
  }
});
