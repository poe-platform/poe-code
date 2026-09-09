import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { HostCallJournal } from "./host-call.js";
import { createSharedArrayBufferStorage } from "./shared-array-buffer.js";
import { encodeReplayData } from "../snapshot/replay-data.js";

it.each(["missing receiver", "wrong arity", "ordinary storage", "duplicate storage", "missing order"])(
  "rejects shared callback state with %s", defect => {
    const journal = new HostCallJournal("shared-callback-validation");
    const buffer = createSharedArrayBufferStorage(4, undefined, new Budget());
    const { record } = journal.issue({ moduleId: "host", operation: "perform", argumentDigest: "callback", policy: "re-issue" });
    journal.registerSharedArguments(record, [buffer]);
    journal.recordCallback(record, 1, [{ label: "receiver" }], 0, true);
    const replay = journal.snapshotReplay();
    const callback = replay.calls[0].callbacks![0];
    if (defect === "missing receiver") callback.sharedState = encodeReplayData([[undefined], buffer]);
    if (defect === "wrong arity") callback.sharedState = encodeReplayData([[], buffer]);
    if (defect === "ordinary storage") callback.sharedState = encodeReplayData([[{}], new ArrayBuffer(4)]);
    if (defect === "duplicate storage") callback.sharedState = encodeReplayData([[{}], buffer, buffer]);
    if (defect === "missing order") delete callback.sharedOrder;
    expect(() => new HostCallJournal("shared-callback-validation", [], undefined, replay)).toThrow(TypeError);
  }
);

it("accepts matching receiver-bearing shared callback state", () => {
  const journal = new HostCallJournal("shared-callback-validation");
  const buffer = createSharedArrayBufferStorage(4, undefined, new Budget());
  const { record } = journal.issue({ moduleId: "host", operation: "perform", argumentDigest: "callback", policy: "re-issue" });
  journal.registerSharedArguments(record, [buffer]);
  journal.recordCallback(record, 1, [{ buffer }], 0, true);
  const restored = new HostCallJournal("shared-callback-validation", [], undefined, journal.snapshotReplay());
  restored.dispose();
});
