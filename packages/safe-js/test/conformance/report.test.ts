import { expect, it } from "vitest";
import { aggregateReports, countEntries } from "./report.js";

const files = [{ filename: "a.js", sourceHash: "a", kind: "test", variants: [{ mode: "sloppy" }, { mode: "strict" }] },
  { filename: "dep_FIXTURE.js", sourceHash: "b", kind: "fixture", variants: [] }];
const manifest = { id: "manifest", files };
const entries = [{ filename: "a.js", sourceHash: "a", kind: "test", results: [{ mode: "sloppy", status: "passed" }, { mode: "strict", status: "unsupported", reason: "strict" }] },
  { filename: "dep_FIXTURE.js", sourceHash: "b", kind: "fixture" }];
function report(selected = entries) {
  return { manifestId: "manifest", selected: selected.map(entry => entry.filename), entries: selected,
    counts: countEntries(selected), complete: true };
}
it("cross-checks complete disjoint selections and keeps unsupported variants nonpassing", () => {
  expect(aggregateReports(manifest, [report(entries.slice(0, 1)), report(entries.slice(1))])).toMatchObject({
    success: false, counts: { files: 2, variants: 2, passed: 1, unsupported: 1 }
  });
});
it.each(["missing", "duplicate", "revision", "hash", "mode", "counts", "incomplete", "selection"])("rejects invalid coverage: %s", defect => {
  const reports = [report()];
  if (defect === "missing") reports[0] = report(entries.slice(0, 1));
  if (defect === "duplicate") reports.push(report());
  if (defect === "revision") reports[0].manifestId = "stale";
  if (defect === "hash") reports[0].entries = [{ ...entries[0], sourceHash: "stale" }, entries[1]];
  if (defect === "mode") reports[0].entries = [{ ...entries[0], results: [entries[0].results![0], entries[0].results![0]] }, entries[1]];
  if (defect === "counts") reports[0].counts.passed++;
  if (defect === "incomplete") reports[0].complete = false;
  if (defect === "selection") reports[0].selected = ["a.js"];
  expect(() => aggregateReports(manifest, reports)).toThrow();
});
