import { expect, it } from "vitest";
import type { CapabilityContext } from "../../contracts.js";
import { recalculateWorkbook } from "../evaluator.js";
import { timezonePeriod } from "./timezones.js";
import { perlSampleFunctions } from "../optional-providers.js";

function date(timezone: string, milliseconds: number) {
  const context: CapabilityContext = {
    own() {}, signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone },
    clock: { now: () => milliseconds }, runtimeFunctions: perlSampleFunctions,
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 2, operations: 1000 }
  };
  return recalculateWorkbook({ sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, formula: '=PERL_DATE()', formulaDirty: true, value: { kind: "blank" } }
  ] }] }, context).sheets[0]!.cells[0]!.value;
}

it.each(['Europe/Amsterdam', 'europe/amsterdam'])("uses historical native timezone offsets for %s", zone => {
  expect(date(zone, -2203891201000)).toEqual({ kind: "string", value: "19000301" });
});
it("preserves date-line skips and half-hour zones", () => {
  expect(date('Pacific/Apia', 1325239199000)).toEqual({ kind: "string", value: "20111229" });
  expect(date('Pacific/Apia', 1325239200000)).toEqual({ kind: "string", value: "20111231" });
  expect(date('Asia/Kathmandu', Date.parse('2024-01-01T18:15:00Z'))).toEqual({ kind: "string", value: "20240102" });
});
it("keeps astronomical years and date-range boundaries", () => {
  expect(date('Etc/UTC', Date.parse('0000-01-01T00:00:00Z'))).toEqual({ kind: "string", value: "00000101" });
  expect(date('Etc/UTC', -8640000000000000)).toEqual({ kind: "string", value: "-2718210420" });
  expect(date('Etc/UTC', 8640000000000000)).toEqual({ kind: "string", value: "2757600913" });
});
it("continues to reject unknown timezone names", () => {
  expect(() => date('Unknown/Nowhere', 0)).toThrow('Invalid ssconvert timezone');
});

// Independent libc offsets from the pinned TZif profile, before/at future transitions.
it.each([
  ['Pacific/Chatham', 2532520799, 49500], ['Pacific/Chatham', 2532520800, 45900],
  ['Asia/Gaza', 26199503999, 7200], ['Asia/Gaza', 26199504000, 10800],
  ['Asia/Gaza', 26218249199, 10800], ['Asia/Gaza', 26218249200, 7200],
  ['Europe/Dublin', 2531955599, 0], ['Europe/Dublin', 2531955600, 3600],
  ['America/Nuuk', 2531955599, -7200], ['America/Nuuk', 2531955600, -3600],
  ['Australia/Lord_Howe', 2532524399, 39600], ['Australia/Lord_Howe', 2532524400, 37800]
] as const)("matches future transition %s at %s", (zone, seconds, expected) => {
  expect(timezonePeriod(zone, seconds * 1000, () => {})?.[0]).toBe(expected);
});
it("charges lookups to the caller's work and cancellation callback", () => {
  const reason = new Error('cancelled by caller');
  expect(() => timezonePeriod('Europe/Amsterdam', 0, () => { throw reason; })).toThrow(reason);
});
