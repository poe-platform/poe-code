import { expect, it } from "vitest";
import { glossaryTimestamp } from "./glossary-timestamp.js";
import { writeGlossary } from "./glossary.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";

// Independently captured libc strftime('%Y-%m-%d %H:%M%Z', localtime(epoch)).
it.each([
  ["2026-03-08T09:59:59Z", "America/Los_Angeles", "2026-03-08 01:59PST"],
  ["2026-03-08T10:00:00Z", "America/Los_Angeles", "2026-03-08 03:00PDT"],
  ["2026-11-01T08:59:59Z", "America/Los_Angeles", "2026-11-01 01:59PDT"],
  ["2026-11-01T09:00:00Z", "America/Los_Angeles", "2026-11-01 01:00PST"],
  ["2026-03-29T00:59:59Z", "Europe/Warsaw", "2026-03-29 01:59CET"],
  ["2026-03-29T01:00:00Z", "Europe/Warsaw", "2026-03-29 03:00CEST"],
  ["2026-10-25T00:59:59Z", "Europe/Warsaw", "2026-10-25 02:59CEST"],
  ["2026-10-25T01:00:00Z", "Europe/Warsaw", "2026-10-25 02:00CET"],
  ["2026-01-01T00:00:00Z", "America/Los_Angeles", "2025-12-31 16:00PST"],
  ["2026-12-31T19:00:00Z", "Asia/Kolkata", "2027-01-01 00:30IST"],
  ["1974-01-06T10:00:00Z", "America/Los_Angeles", "1974-01-06 03:00PDT"],
  ["1974-07-01T12:00:00Z", "Europe/Warsaw", "1974-07-01 13:00CET"],
  ["1970-01-01T00:00:00Z", "UTC", "1970-01-01 00:00UTC"],
  ["2037-12-31T23:59:59Z", "Asia/Kolkata", "2038-01-01 05:29IST"],
])("uses source transitions and civil time: %s %s", (iso, zone, expected) => {
  expect(glossaryTimestamp(Date.parse(iso), zone, () => {})).toBe(expected);
});

it.each(["Europe/London", "Asia/Calcutta", "invalid", "toString", "__proto__"])("refuses uncaptured timezone %s explicitly", zone => {
  expect(() => glossaryTimestamp(1768912440000, zone, () => {})).toThrow(expect.objectContaining({ code: "capability-denied" }));
});
it.each([-1, Date.UTC(2038, 0, 1), 8.64e15])("refuses dates outside the source profile: %s", time => {
  expect(() => glossaryTimestamp(time, "UTC", () => {})).toThrow(expect.objectContaining({ code: "capability-denied" }));
});
it.each([NaN, Infinity, -Infinity])("retains invalid-clock errors: %s", time => {
  expect(() => glossaryTimestamp(time, "UTC", () => {})).toThrow(expect.objectContaining({ code: "invalid-request" }));
});
it("admits bounded transition search and preserves cancellation reasons", () => {
  let ticks = 0;
  glossaryTimestamp(1789907640000, "America/Los_Angeles", () => ticks++);
  expect(ticks).toBeGreaterThan(0);
  expect(ticks).toBeLessThanOrEqual(9);
  const reason = Object.freeze({ cancelled: true });
  expect(() => glossaryTimestamp(1789907640000, "America/Los_Angeles", () => { throw reason; })).toThrow(reason);
});

const book: Workbook = { sheets: [{ id: "g", name: "Glossary", cells: [{ row: 0, column: 0, value: { kind: "string", value: "Term" } }] }] };
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "America/Los_Angeles" }, clock: { now: () => 1789907640000 },
  limits: { inputBytes: 1000, outputBytes: 1000, cells: 10, sheets: 1, operations: 100 } };
it("retains output-byte and work bounds with timezone resolution", async () => {
  await expect(writeGlossary(book, [], { ...context, limits: { ...context.limits, outputBytes: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
  await expect(writeGlossary(book, [], { ...context, limits: { ...context.limits, workbookWork: 3 } })).rejects.toMatchObject({ code: "resource-limit" });
});

it("floors fractional injected instants before applying a negative offset", () => {
  expect(glossaryTimestamp(59999.5, "America/Los_Angeles", () => {})).toBe("1969-12-31 16:00PST");
});
