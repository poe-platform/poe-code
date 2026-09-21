import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readPsion } from "./psion.js";
import { psionFixture } from "./psion-fixture.test-support.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 10000 } };
const dword = (n: number) => [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24];
function fixture(layout: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(1200); bytes.set(psionFixture());
  new DataView(bytes.buffer).setUint32(49, 500, true);
  bytes.set([...dword(1), ...Array<number>(24).fill(0), 1, 0, 0, 0, 0, ...dword(0), ...dword(0),
    ...dword(0x1000005c), ...dword(0x10000066), ...dword(900), ...dword(0x10000064), 4, 72, 6,
    ...Array<number>(6).fill(0), ...dword(0x100000fd), ...dword(11906), ...dword(16838), 0], 500);
  bytes.set(layout, 900); return bytes;
}
const inlineLayout = (codes: readonly number[], type = 0) => [1, 0, 0, ...dword(1), ...dword(2), 0,
  ...dword(0), 255, ...dword(1), ...dword(1), type, ...dword(1), ...dword(codes.length), ...codes];

it("Psion inline page fonts preserve raw non-ASCII names without Sheet ABI conversion", async () => {
  const book = await readPsion(fixture(inlineLayout([0x22, 2, 0xe9, 3])), context);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
});

it.each([[0x22, 1], [0x22, 3, 65], [0x19, 1], [0x1c, 1, 0], [0x1e]])
  ("Psion inline character structures reject truncated declared payloads (%#)", async (...codes: number[]) => {
    await expect(readPsion(fixture(inlineLayout(codes)), context)).rejects.toThrow("Error while parsing Psion file.");
  });

it("Psion anonymous page style preview remains bounded by the complete byte input", async () => {
  const layout = [1, 0, 1, ...dword(1), ...dword(0xffffffff)];
  await expect(readPsion(fixture(layout), context)).rejects.toThrow("Error while parsing Psion file.");
});

it("Psion embedded inline page objects report the explicit remaining qualification gap", async () => {
  await expect(readPsion(fixture(inlineLayout([], 1)), context)).rejects.toMatchObject({ code: "unsupported-feature" });
});

it("Psion page paragraph counts share the injected operation budget", async () => {
  const layout = [1, 0, 0, ...dword(0xffffffff)];
  await expect(readPsion(fixture(layout), { ...context, limits: { ...context.limits, operations: 80 } })).rejects.toThrow("operations limit exceeded");
});

it("Psion styled page traversal preserves cancellation", async () => {
  const controller = new AbortController(), reason = new Error("stop styled page"); let checks = 0;
  const signal = { throwIfAborted() { if (++checks === 70) controller.abort(reason); controller.signal.throwIfAborted(); } } as AbortSignal;
  await expect(readPsion(fixture(inlineLayout([])), { ...context, signal })).rejects.toBe(reason);
  expect(checks).toBe(71);
});
