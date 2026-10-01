import { expect, it } from "vitest";
import { capturedBesselPhase } from "./captured-bessel-phase.js";
import { recalculateWorkbook } from "../evaluator.js";
import type { CapabilityContext } from "../../contracts.js";
import type { FunctionHost } from "./types.js";

for (const secondKind of [false, true]) it(`paired Bessel square boundary terminates within its operation budget, secondKind=${secondKind}`, () => {
  let ticks = 0;
  const warnings: unknown[] = [];
  const host = { tick() { if (++ticks > 10000) throw new Error("operation budget exceeded"); }, diagnostic(value: unknown) { warnings.push(value); } } as unknown as FunctionHost;
  expect(capturedBesselPhase(1.3407807929942596e154, 0, secondKind, host)).toBeNaN();
  expect(ticks).toBeLessThan(10);
  expect(warnings).toHaveLength(1);
});

for (const name of ["BESSELJ", "BESSELY"]) it(`${name} reports NUM at the paired square boundary within a bounded calculation`, () => {
  const context: CapabilityContext = {
    signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 1, operations: 10000, workbookWork: 100000 },
  };
  const book = recalculateWorkbook({ sheets: [{ id: "s", name: "Data", cells: [{ row: 0, column: 0,
    formula: `=${name}(1.3407807929942596e154,0)`, value: { kind: "blank" },
  }] }] }, context, true);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#NUM!" });
});
