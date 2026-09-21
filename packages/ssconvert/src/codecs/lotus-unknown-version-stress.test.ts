import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { probeLotus, readLotus } from "./lotus.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 10000 } };
const record = (id: number, data: readonly number[] = []) => [id & 255, id >>> 8, data.length & 255, data.length >>> 8, ...data];
function fixture(version: number): Uint8Array {
  return Uint8Array.from([...record(0, [version & 255, version >>> 8, ...Array<number>(14).fill(0), 1, 0, 0]),
    ...record(20, [0, 0, 0, 0]), ...record(1)]);
}
it.each([0x1006, 0x407, 0xffff])("Lotus explicit unknown version %x warns and uses native modern record dispatch", async version => {
  const bytes = fixture(version), warnings: string[] = [];
  expect(probeLotus(bytes, context)).toBe(false);
  const book = await readLotus(bytes, { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(warnings).toEqual([`Unexpected version ${version.toString(16)}`]);
  expect(book.sheets[0]!.name).toBe("Sheet1");
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#VALUE!" });
});
it("Lotus unknown-version warning preserves injected cancellation", async () => {
  const controller = new AbortController(), reason = new Error("stop unknown version");
  await expect(readLotus(fixture(0x1006), { ...context, signal: controller.signal,
    async diagnostic(d) { expect(d.message).toBe("Unexpected version 1006"); controller.abort(reason); } })).rejects.toBe(reason);
});
