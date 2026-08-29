import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Budget, declareHostOperation, dump, restore, run } from "../src/index.js";
import type { RunSnapshot } from "../src/run.js";
import legacyCaptures from "./fixtures/public-promise-v6.json" with { type: "json" };
import { fullSource, singleSource } from "./fixtures/public-promise-inputs.js";

function frozenEvidence(name: string, sha256: string) {
  const bytes = readFileSync(
    new URL(`./fixtures/ppr2-integration-history/${name}`, import.meta.url)
  );
  if (createHash("sha256").update(bytes).digest("hex") !== sha256)
    throw Error(`Frozen evidence changed: ${name}`);
  return JSON.parse(bytes.toString());
}

const rawHistory = frozenEvidence(
  "ordered-original-red.json",
  "a9feba99d6e0f02d631f8b38c4e027beaa30d7d240b0f8666edbb3ada26bed62"
) as {
  records: Array<{
    name: string;
    sourceSha256: string;
    saved: RunSnapshot;
    completed: RunSnapshot;
  }>;
};
const legacyHistory = frozenEvidence(
  "ordered-v6-generations.json",
  "d72a81042ddabc34835079e7d9e8aa53c058390ae9860fdbbe1d0051a01533ae"
) as {
  records: Array<{
    name: string;
    mode: string;
    generation: number;
    emitted: RunSnapshot;
    captured?: RunSnapshot;
  }>;
};

describe("independent preserved v6 history, never relabelled", () => {
  it.each(
    rawHistory.records.flatMap((record) =>
      (["saved", "completed"] as const).map((kind) => ({ ...record, kind }))
    )
  )(
    "original ordered raw $name/$kind is accepted but retains its original TypeError",
    async (record) => {
      const source = record.name === "single" ? singleSource : fullSource;
      expect(createHash("sha256").update(source).digest("hex")).toBe(record.sourceSha256);
      const snapshot = record[record.kind];
      const original = JSON.stringify(snapshot);
      expect(snapshot.executionSemantics).toBe("jobs-v6");
      expect(restore(snapshot, { source })).toBe(snapshot);
      const boundary = vi.fn(async (label: unknown) => ({ boundary: label }));
      const provider = vi.fn();
      await expect(
        run(source, {
          snapshot,
          bindings: { boundary: declareHostOperation(boundary, "re-issue") },
          hostCallResumeProvider: provider,
          budget: new Budget({ maxSteps: 150_000 })
        })
      ).rejects.toMatchObject({
        name: "TypeError",
        message: "Promise replay references work not created at this position."
      });
      expect(boundary).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
      expect(JSON.stringify(snapshot)).toBe(original);
      expect(snapshot.executionSemantics).toBe("jobs-v6");
    }
  );

  it.each(legacyHistory.records)(
    "preserves genuine $name/$mode/$generation emission and continuation",
    async (record) => {
      const fixture = legacyCaptures.cases.find((candidate) => candidate.name === record.name);
      if (!fixture) throw Error("Unknown genuine v6 fixture");
      const snapshot = record.emitted;
      const original = JSON.stringify(snapshot);
      expect(snapshot.executionSemantics).toBe("jobs-v6");
      const boundary = vi.fn(async (label: unknown) => ({ boundary: label }));
      const readValue = vi.fn();
      const provider = vi.fn();
      const bindings = {
        boundary: declareHostOperation(boundary, "re-issue"),
        readValue: declareHostOperation(readValue, "re-issue")
      };
      const execution = run(fixture.source, {
        snapshot: restore(snapshot, { source: fixture.source }),
        bindings,
        hostCallResumeProvider: provider
      });
      let completed: RunSnapshot;
      if (record.mode === "failure") {
        await expect(execution).rejects.toThrow("Independent boundary failure");
        completed = JSON.parse(await dump(execution, { onFailure: "checkpoint" }));
      } else {
        expect(await execution).toMatchObject({ ok: true, returnValue: { value: 7 } });
        completed = JSON.parse(await dump(execution));
      }
      expect(completed.executionSemantics).toBe("jobs-v6");
      expect(JSON.stringify(completed.initialInputs)).toBe(JSON.stringify(snapshot.initialInputs));
      expect(JSON.stringify(completed.promiseReplay)).toBe(JSON.stringify(snapshot.promiseReplay));
      expect(JSON.stringify(completed.replay)).toBe(JSON.stringify(snapshot.replay));
      expect(JSON.stringify(snapshot)).toBe(original);
      expect(boundary).not.toHaveBeenCalled();
      expect(readValue).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
      if (record.captured) {
        const captured = JSON.stringify(record.captured);
        expect(record.captured.executionSemantics).toBe("jobs-v6");
        const resumed = await run(fixture.source, {
          snapshot: restore(record.captured, { source: fixture.source }),
          bindings,
          hostCallResumeProvider: provider
        });
        expect(resumed).toMatchObject({
          ok: true,
          returnValue: { value: 7 },
          snapshot: { executionSemantics: "jobs-v6" }
        });
        expect(boundary.mock.calls).toEqual([["before"]]);
        expect(readValue).not.toHaveBeenCalled();
        expect(provider).not.toHaveBeenCalled();
        expect(JSON.stringify(record.captured)).toBe(captured);
        expect(JSON.parse(await dump(resumed)).executionSemantics).toBe("jobs-v6");
      }
    }
  );
});
