import { expect, it, vi } from "vitest";
import { defaultSsconvertLimits } from "@poe-code/spreadsheet-engine";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { createXlsxStreamWriter } from "./xlsx.js";

const book = { sheets: [{ id: "s", name: "Data", cells: [] }] };
it.each([false, true])("registers storage cleanup before acquisition and preserves operation plus cleanup errors (axes: %s)", async axes => {
  const operation = new Error("storage write"), cleanup = new Error("storage close");
  let owned = false;
  const close = vi.fn(async () => { throw cleanup; });
  const context: CapabilityContext = { signal: new AbortController().signal, limits: defaultSsconvertLimits,
    environment: { env: {}, locale: "C", timezone: "UTC" }, own() { owned = true; },
    createWorkingStorage() {
      expect(owned).toBe(true);
      return { allocate() { return 8; }, async read() { throw new Error("unexpected read"); },
        async write() { throw operation; }, close };
    } };
  const input = axes ? { sheets: [{ ...book.sheets[0]!, rows: [{ index: 0, sizePoints: 17 }] }] } : book;
  const stream = createXlsxStreamWriter("2008")(input, [], context);
  await expect(async () => { for await (const chunk of stream) void chunk; }).rejects.toMatchObject({ errors: [operation, cleanup] });
  expect(close).toHaveBeenCalledOnce();
});

it("does not acquire storage after the owner has already revoked the export", async () => {
  const acquire = vi.fn(() => { throw new Error("unexpected acquisition"); });
  const context: CapabilityContext = { signal: new AbortController().signal, limits: defaultSsconvertLimits,
    environment: { env: {}, locale: "C", timezone: "UTC" }, own(cleanup) { void cleanup(); }, createWorkingStorage: acquire };
  const stream = createXlsxStreamWriter("2008")(book, [], context);
  await expect(async () => { for await (const chunk of stream) void chunk; }).rejects.toThrow("closed"); expect(acquire).not.toHaveBeenCalled();
});
