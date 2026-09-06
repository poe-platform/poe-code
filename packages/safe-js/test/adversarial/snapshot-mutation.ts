import { performance } from "node:perf_hooks";

import { dump } from "../../src/dump.js";
import { run } from "../../src/run.js";
import { restore, SnapshotMismatchError } from "../../src/restore.js";
import { SnapshotValidationError } from "../../src/snapshot/validation.js";
import { DUMP_FORMAT_VERSION } from "../../src/snapshot/dump-format.js";
import { adversarialFailure, minimizeSnapshot } from "./report.js";
import { createRandom, pick, randomInt } from "./random.js";

export const SNAPSHOT_MUTATION_SEED = 0x5a90_2026;
const CASE_COUNT = process.env.SAFEJS_ADVERSARIAL_SLOW === "1" ? 2_000 : 96;
const MAX_DURATION_MS = process.env.SAFEJS_ADVERSARIAL_SLOW === "1" ? 15_000 : 750;
const SOURCE = "const values = [1, 2, 3]; return JSON.stringify(values);";

export async function runSnapshotMutationCorpus(): Promise<void> {
  const initial = await run(SOURCE, { randomSeed: 7 });
  const validDump = await dump(initial);
  const validSnapshot = JSON.parse(validDump) as Record<string, unknown>;
  const resumed = await run(SOURCE, { snapshot: restore(validSnapshot, { source: SOURCE }) });
  if (resumed.returnValue !== initial.returnValue || (await dump(resumed)) !== validDump) {
    throw adversarialFailure({
      cause: new Error("valid dump/restore changed output"),
      kind: "snapshot",
      seed: SNAPSHOT_MUTATION_SEED,
      value: validDump
    });
  }

  const random = createRandom(SNAPSHOT_MUTATION_SEED);
  const startedAt = performance.now();
  for (let index = 0; index < CASE_COUNT; index += 1) {
    const snapshot = structuredClone(validSnapshot);
    mutate(snapshot, random, index);
    try {
      restore(snapshot as never, { source: SOURCE });
      throw new Error("malformed snapshot was accepted");
    } catch (error) {
      if (!(error instanceof SnapshotValidationError || error instanceof SnapshotMismatchError)) {
        const minimized = minimizeSnapshot(snapshot, hasUnexpectedRestoreFailure);
        throw adversarialFailure({
          cause: error,
          kind: "snapshot",
          seed: SNAPSHOT_MUTATION_SEED,
          value: minimized
        });
      }
    }
  }

  const duration = performance.now() - startedAt;
  if (duration > MAX_DURATION_MS) {
    throw adversarialFailure({
      cause: new Error(
        `case cap exceeded time cap: ${duration.toFixed(1)}ms > ${MAX_DURATION_MS}ms`
      ),
      kind: "snapshot",
      seed: SNAPSHOT_MUTATION_SEED,
      value: validDump
    });
  }
}

function hasUnexpectedRestoreFailure(snapshot: Record<string, unknown>): boolean {
  try {
    restore(snapshot as never, { source: SOURCE });
    return false;
  } catch (error) {
    return !(error instanceof SnapshotValidationError || error instanceof SnapshotMismatchError);
  }
}

function mutate(snapshot: Record<string, unknown>, random: () => number, index: number): void {
  const mutation = index % 8;
  if (mutation === 0) snapshot.version = pick(random, [0, DUMP_FORMAT_VERSION + 1, "1", null]);
  if (mutation === 1) snapshot.sourceHash = pick(random, ["", 7, "changed"]);
  if (mutation === 2) snapshot.clock = { next: pick(random, [-1, 1.5, "soon"]) };
  if (mutation === 3) snapshot.random = { seed: 1, state: pick(random, [-1, 1.5, "bad"]) };
  if (mutation === 4) snapshot.heap = { "1": { kind: "mystery" } };
  if (mutation === 5) {
    const missingId = Object.keys((snapshot.heap ?? {}) as object).reduce((maximum, id) => Math.max(maximum, Number(id)), 0) + 1;
    snapshot.bindings = { missing: { kind: "ref", id: missingId } };
  }
  if (mutation === 6) snapshot.pendingAwaits = pick(random, [{}, [null], [{ nodeId: -1 }]]);
  if (mutation === 7)
    snapshot.loopIterations = { [String(randomInt(random, 4))]: { index: -1, values: [] } };
}
