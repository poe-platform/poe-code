import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { HostCallJournal } from "./host-call.js";
import { deepCopyToSandbox, measureSandboxData } from "./values.js";

it("accounts for captured Promise properties when retaining a host outcome", () => {
  const native = Object.assign(new Promise(() => {}), { data: Array.from({ length: 32 }, () => ({ count: 1 })) });
  const value = deepCopyToSandbox({ nested: native });
  const budget = new Budget();
  const journal = new HostCallJournal("source", [], undefined, undefined, budget);
  const record = journal.issue({ moduleId: "host", operation: "load", argumentDigest: "args", policy: "re-issue" }).record;
  const before = budget.currentDataSize;
  journal.settle(record, { status: "fulfilled", value });
  expect(budget.currentDataSize - before).toBeGreaterThanOrEqual(measureSandboxData([value], { ignoreClosures: true }));
});

it("rejects a host outcome when only its uncaptured properties fit the data budget", () => {
  const native = Object.assign(new Promise(() => {}), { data: Array.from({ length: 32 }, () => ({ count: 1 })) });
  const value = deepCopyToSandbox({ nested: native });
  const budget = new Budget({ dataSize: measureSandboxData([value], { ignoreClosures: true }) });
  const journal = new HostCallJournal("source", [], undefined, undefined, budget);
  const record = journal.issue({ moduleId: "host", operation: "load", argumentDigest: "args", policy: "re-issue" }).record;
  const before = budget.currentDataSize;
  expect(() => journal.settle(record, { status: "fulfilled", value }))
    .toThrow(expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" }));
  expect(budget.currentDataSize).toBe(before);
  expect(record.lifecycle).toBe("created");
  expect(record.outcome).toBeUndefined();
});
