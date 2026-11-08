import { describe, expect, it } from "vitest";
import { Budget, deepCopyFromSandbox, dump, restore, run } from "@poe-code/safe-js";
import { bounded } from "./fixtures/final-async-proof.js";
import { LifecycleRig, completionReceipts } from "./fixtures/final-async-proof-hosts.js";
import {
  asyncNativeAnchors,
  lifecycleCases,
  originalSources
} from "./fixtures/final-async-proof-cases.js";

describe("bounded original lifecycle host fixtures", () => {
  it.each(["callbackFunction", "callbackData", "retry"] as const)(
    "anchors unchanged %s source natively",
    async (sourceKey) => {
      const selected = lifecycleCases.find((entry) => entry.sourceKey === sourceKey)!;
      const rig = new LifecycleRig(selected, "capture");
      const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
      const execution = new AsyncFunction(...Object.keys(rig.bindings), originalSources[sourceKey])(
        ...Object.values(rig.bindings)
      );
      await rig.reachCapture();
      await rig.finishOriginal();
      const anchor =
        asyncNativeAnchors[
          sourceKey === "retry"
            ? "retry-reissue"
            : sourceKey === "callbackFunction"
              ? "callback-external"
              : "callback-external-data"
        ];
      expect(await bounded(execution, "native original")).toEqual(anchor.value);
      expect(rig.calls).toEqual(anchor.calls);
    }
  );

  it.each(["callbackData", "callbackFunction"] as const)(
    "restores original %s with real callback IDs and exact suffix",
    async (sourceKey) => {
      const selected = lifecycleCases.find((entry) => entry.sourceKey === sourceKey)!;
      const rig = new LifecycleRig(selected, "capture");
      const source = originalSources[sourceKey];
      const anchor =
        asyncNativeAnchors[
          sourceKey === "callbackData" ? "callback-external-data" : "callback-external"
        ];
      const execution = run(source, {
        bindings: rig.bindings,
        budget: new Budget({ maxSteps: 75000 })
      });
      await rig.reachCapture();
      const serialized = await bounded(dump(execution, { mode: "replay" }), "original capture");
      await rig.finishOriginal();
      const original = await bounded(execution, "original completion");
      expect(original.ok).toBe(true);
      if (!original.ok) return;
      expect(deepCopyFromSandbox(original.returnValue)).toEqual(anchor.value);
      const resume = new LifecycleRig(selected, "resume");
      const result = await bounded(
        run(source, {
          snapshot: restore(JSON.parse(serialized), { source }),
          bindings: resume.bindings,
          hostCallResumeProvider: resume.provider(
            JSON.parse(serialized),
            completionReceipts(original)
          ),
          budget: new Budget({ maxSteps: 75000 })
        }),
        "data resume"
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(deepCopyFromSandbox(result.returnValue)).toEqual(anchor.value);
      expect(resume.calls).toEqual(selected.expectedRemainingCalls);
      expect(resume.proofReturns).toHaveLength(1);
      console.log(
        JSON.stringify({
          id: selected.id,
          originalCapture: serialized,
          resumedCapture: await dump(result),
          events: resume.events,
          calls: resume.calls,
          proofReturns: resume.proofReturns
        })
      );
    }
  );
});
