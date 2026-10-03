import { expect, it } from "vitest";
import { defaultSsconvertLimits, SsconvertError, type CapabilityContext } from "@poe-code/spreadsheet-engine";
import { probeOdf, readOdf } from "./odf.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" }, limits: defaultSsconvertLimits };

it.each([new Error("range failed"), new SsconvertError("io", "range failed"), null])("preserves retained source failures (%s)", async failure => {
  const source = { size: 100, async read() { throw failure; } };
  await expect(probeOdf(source, context)).rejects.toBe(failure);
  await expect(readOdf(source, context)).rejects.toBe(failure);
});

it("cancels a retained archive read without replacing the cancellation reason", async () => {
  const controller = new AbortController(), failure = new Error("cancelled");
  await expect(readOdf({ size: 100, async read() {
    controller.abort(failure); return new Uint8Array(100);
  } }, { ...context, signal: controller.signal })).rejects.toBe(failure);
});
