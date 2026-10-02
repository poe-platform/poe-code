import { expect, it } from "vitest";
import { prepareChartWorkbookMembers } from "./chart-workbook.js";
import { writePackageArchive } from "./package-writer.js";
import { validateChartWorkbook } from "./chart-workbook.js";
const context = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 262144,
    maxEntryBytes: 65536,
    maxTotalBytes: 262144,
    maxMembers: 64,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 65536,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};
it("prepares original workbook XML synchronously for deferred serialization", async () => {
  const entries = prepareChartWorkbookMembers(
    { categories: ["Delta"], series: [{ name: "Survey", values: [23] }] },
    false,
    context
  );
  expect(entries).not.toBeInstanceOf(Promise);
  expect(
    new TextDecoder().decode(
      entries.find((entry) => entry.name === "xl/worksheets/sheet1.xml")!.bytes
    )
  ).toContain("<v>23</v>");
  const bytes = await writePackageArchive(entries, context, { compression: "store" });
  expect(await validateChartWorkbook(bytes, context)).toMatchObject({
    sheetName: "Sheet1",
    date1904: false
  });
});
it("rejects cancellation and XML budgets while preparing before deferred publication", () => {
  const data = { categories: ["Delta"], series: [{ name: "Survey", values: [23] }] };
  expect(() =>
    prepareChartWorkbookMembers(data, false, { ...context, signal: AbortSignal.abort() })
  ).toThrow("Workbook preparation cancelled");
  expect(() =>
    prepareChartWorkbookMembers(data, false, {
      ...context,
      xmlLimits: { ...context.xmlLimits, maxBytes: 32 }
    })
  ).toThrow();
});
it.each(["maxArchiveBytes", "maxEntryBytes", "maxTotalBytes", "maxMembers"] as const)(
  "enforces %s before queueing a workbook",
  (limit) => {
    const data = { categories: ["Delta"], series: [{ name: "Survey", values: [23] }] };
    expect(() =>
      prepareChartWorkbookMembers(data, false, {
        ...context,
        archiveLimits: { ...context.archiveLimits, [limit]: 1 }
      })
    ).toThrow();
  }
);
