import { expect, it } from "vitest";
import { aggregateReports, countEntries, type SelectionReport } from "./report.js";

const manifest = { id: "oracle-control", files: [
  { filename: "control.js", sourceHash: "pinned-source", kind: "test", variants: [{ mode: "strict" }] }
] };
const entries = [{ filename: "control.js", sourceHash: "pinned-source", kind: "test",
  results: [{ mode: "strict", status: "passed" }] }];
const completed: SelectionReport = { manifestId: manifest.id, selected: ["control.js"],
  entries, counts: countEntries(entries), complete: true };

it("accepts the neighboring explicitly completed execution", () => {
  expect(aggregateReports(manifest, [completed])).toMatchObject({ success: true, enumeratedVariants: 1 });
});

it.each(["true", "false", 1, [], {}])("rejects a malformed completion receipt: %j", complete => {
  const mutated = { ...completed, complete } as unknown as SelectionReport;
  expect(() => aggregateReports(manifest, [mutated])).toThrow("Incomplete or mixed-provenance report");
});

it("cannot make a fixture-only corpus green", () => {
  const files = [{ filename: "dep_FIXTURE.js", sourceHash: "dependency", kind: "fixture", variants: [] }];
  const rows = [{ filename: "dep_FIXTURE.js", sourceHash: "dependency", kind: "fixture" }];
  expect(aggregateReports({ ...manifest, files }, [{ ...completed, selected: [rows[0].filename],
    entries: rows, counts: countEntries(rows) }])).toMatchObject({ success: false, enumeratedVariants: 0 });
});

it("cannot make an empty corpus green", () => {
  expect(aggregateReports({ ...manifest, files: [] }, [])).toMatchObject({ success: false, enumeratedVariants: 0 });
});
