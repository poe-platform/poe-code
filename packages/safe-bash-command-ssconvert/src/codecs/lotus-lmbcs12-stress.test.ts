import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readLotus } from "./lotus.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 4, operations: 100 } };
function record(id: number, data: number[] = []): number[] {
  return [id & 255, id >> 8, data.length & 255, data.length >> 8, ...data];
}
async function label(data: number[], group: number) {
  const bytes = Uint8Array.from([...record(0, [5, 16, ...Array<number>(14).fill(0), group, 0, 0]),
    ...record(22, [0, 0, 0, 0, 39, ...data]), ...record(1)]);
  const book = await readLotus(bytes, context);
  return book.sheets[0]!.cells[0]!.value;
}

it("Lotus implicit LMBCS12 default group mixes DBCS, ASCII and explicit group escapes", async () => {
  expect(await label([0xa4, 0xa4, 65, 0x12, 0xa4, 0xa4, 0], 0x12)).toEqual({ kind: "string", value: "中A中" });
});

it("Lotus explicit LMBCS12 consumes a NUL trail as part of its rejected pair", async () => {
  expect(await label([0x12, 0xa4, 0, 65, 0], 1)).toEqual({ kind: "string", value: "A" });
});
