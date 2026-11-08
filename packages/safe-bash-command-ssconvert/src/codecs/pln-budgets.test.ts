import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readPln } from "./pln.js";

it("PlanPerfect formula decoding consumes a cumulative token budget across cells", async () => {
  const header = [255, 87, 80, 67, 16, 0, 0, 0, 9, 10, 5, 0, 0, 0, 0, 0, 25, 0, 0, 0];
  const formula = [7, 0, 10, 1, 49, 1, 10, 1, 50];
  const cell = (column: number) => [0, 0, column, 0, 65, 16, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, formula.length, 0, ...formula];
  const bytes = Uint8Array.from([...header, ...cell(0), ...cell(1), 255, 255, ...Array<number>(18).fill(0)]);
  const context: CapabilityContext = { signal: new AbortController().signal, own() {},
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 1, operations: 3 } };
  await expect(readPln(bytes, context)).rejects.toThrow("operations limit exceeded");
});
