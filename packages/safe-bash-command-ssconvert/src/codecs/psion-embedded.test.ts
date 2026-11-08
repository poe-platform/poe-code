import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readPsion } from "./psion.js";
import { psionFixture } from "./psion-fixture.test-support.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 10000 } };
const dword = (n: number) => [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24];
const text = (s: string) => [s.length * 4 + 2, ...Array.from(s, ch => ch.charCodeAt(0))];
function fixture(type = 0x76543210, app = "unknown.app"): Uint8Array {
  const bytes = new Uint8Array(2000); bytes.set(psionFixture());
  new DataView(bytes.buffer).setUint32(49, 500, true);
  bytes.set([...dword(1), ...Array<number>(24).fill(0), 1, 0, 0, 0, 0, ...dword(0), ...dword(0),
    ...dword(0x1000005c), ...dword(0x10000066), ...dword(900), ...dword(0x10000064), 4, 72, 6,
    ...Array<number>(6).fill(0), ...dword(0x100000fd), ...dword(11906), ...dword(16838), 0], 500);
  bytes.set([0, 0, 0, ...dword(1), ...dword(2), 0, ...dword(0), ...dword(1), ...dword(1),
    1, ...dword(1), ...dword(0), ...dword(0x10000051), ...dword(1100), ...dword(200), ...dword(300)], 900);
  bytes.set([2, ...dword(0x10000144), ...dword(1200)], 1100);
  bytes.set([...dword(4), 2, ...dword(0x10000089), ...dword(100)], 1200);
  bytes.set([...dword(type), ...text(app)], 1300);
  return bytes;
}
function page(): number[] {
  return [...dword(1), ...Array<number>(24).fill(0), ...Array<number>(12).fill(0), ...dword(0x100000fd), ...dword(11906), ...dword(16838), 0];
}
it("Psion page embedded unknown file types are parsed structurally and ignored", async () => {
  const book = await readPsion(fixture(), context);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
});
it("Psion embedded TextEd offsets are relative to the nested file", async () => {
  const bytes = fixture(0x10000085, "TEXTED.APP");
  bytes.set([...dword(4), 6, ...dword(0x10000089), ...dword(100), ...dword(0x10000105), ...dword(200), ...dword(0x10000085), ...dword(300)], 1200);
  bytes.set(page(), 1400);
  bytes.set([...dword(0x1000005c), ...dword(0x10000064), 4, 65, 6], 1500);
  expect((await readPsion(bytes, context)).sheets).toHaveLength(1);
});
it("Psion embedded application ID sections are mandatory", async () => {
  const bytes = fixture(); bytes[1204] = 0;
  await expect(readPsion(bytes, context)).rejects.toThrow("Error while parsing Psion file.");
});
it("Psion embedded TextEd requires its page and text body sections", async () => {
  await expect(readPsion(fixture(0x10000085, "texted.app"), context)).rejects.toThrow("Error while parsing Psion file.");
});
it("Psion nested Word requires its actual document sections", async () => {
  await expect(readPsion(fixture(0x1000007f, "word.app"), context)).rejects.toThrow("Error while parsing Psion file.");
});
it("Psion embedded object pointers cannot leave the input", async () => {
  const bytes = fixture(); new DataView(bytes.buffer).setUint32(1105, 5000, true);
  await expect(readPsion(bytes, context)).rejects.toThrow("Error while parsing Psion file.");
});
it("Psion embedded marker mismatch is nonfatal as in psiconv", async () => {
  const bytes = fixture(); new DataView(bytes.buffer).setUint32(933, 0x12345678, true);
  expect((await readPsion(bytes, context)).sheets).toHaveLength(1);
});
it("Psion display-only object entry is not parsed without an icon in released psiconv", async () => {
  const bytes = fixture(); bytes.set([4, ...dword(0x10000146), ...dword(5000), ...dword(0x10000144), ...dword(1200)], 1100);
  expect((await readPsion(bytes, context)).sheets).toHaveLength(1);
});
it("Psion icon and display sections consume their complete structures", async () => {
  const bytes = fixture();
  bytes.set([6, ...dword(0x10000146), ...dword(1600), ...dword(0x1000012a), ...dword(1700), ...dword(0x10000144), ...dword(1200)], 1100);
  bytes.set([3, ...dword(200), ...dword(300), ...dword(123)], 1600);
  bytes.set([...text("icon"), ...dword(200), ...dword(300)], 1700);
  expect((await readPsion(bytes, context)).sheets).toHaveLength(1);
  new DataView(bytes.buffer).setUint32(1113, 1999, true);
  await expect(readPsion(bytes, context)).rejects.toThrow("Error while parsing Psion file.");
});
it("Psion embedded known TextEd application names match case but not suffixes", async () => {
  const bytes = fixture(0x10000085, "texted.appx");
  bytes.set([...dword(4), 6, ...dword(0x10000089), ...dword(100), ...dword(0x10000105), ...dword(200), ...dword(0x10000085), ...dword(300)], 1200);
  bytes.set(page(), 1400); bytes.set([...dword(0x1000005c), ...dword(0x10000064), 0], 1500);
  await expect(readPsion(bytes, context)).rejects.toThrow("Error while parsing Psion file.");
});
it("Psion embedded structures share the caller operation budget", async () => {
  await expect(readPsion(fixture(), { ...context, limits: { ...context.limits, operations: 125 } })).rejects.toThrow("operations limit exceeded");
});
it("Psion nested Sheet uses the actual shared parser without importing its workbook", async () => {
  const bytes = fixture(); bytes.set(psionFixture([0, 0, 0, 32, 99, 0, 0, 0]), 1200);
  new DataView(bytes.buffer).setUint32(1200, 20, true);
  const book = await readPsion(bytes, context);
  expect(book.sheets).toHaveLength(1);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
  // The nested Sheet is parsed rather than extension-/header-only accepted.
  bytes[1366] = 255;
  await expect(readPsion(bytes, context)).rejects.toThrow("Error while parsing Psion file.");
});
