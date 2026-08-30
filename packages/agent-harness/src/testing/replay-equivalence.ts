import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { Snapshot, SnapshotBackend } from "@poe-code/safe-js";

import { hasOwnErrorCode } from "../error-codes.js";
import { runHarnessPair, type RunHarnessPairOptions, type RunResult } from "../loader/run.js";

type ModulesFor = RunHarnessPairOptions["modulesFor"];

let nextReplayId = 0;

export async function assertReplayEquivalent(path: string, modulesFor: ModulesFor): Promise<void> {
  const snapshotPath = await createSnapshotPath();
  const hostCallStorePath = `${snapshotPath}.host-calls.json`;
  const originalBackend = new MemorySnapshotBackend();

  try {
    const original = await runHarnessPair(path, {
      clock: createDeterministicClock(),
      modulesFor,
      preserveSnapshotOnSuccess: true,
      resume: false,
      snapshotBackend: originalBackend,
      // Force the scheduler threshold into the past so every yielded snapshot is captured.
      snapshotIntervalMs: -1,
      snapshotPath
    });
    const originalReturnValue = readReturnValue(original, "original");
    const originalHostCalls = await readOptionalTextFile(hostCallStorePath);
    const snapshots = [...originalBackend.writes, original.snapshot];

    for (let index = 0; index < snapshots.length; index += 1) {
      const replaySnapshot = snapshots[index];
      await restoreOptionalTextFile(hostCallStorePath, originalHostCalls);
      const replayReturnValue = readReturnValue(
        await runHarnessPair(path, {
          clock: createDeterministicClock(),
          modulesFor,
          preserveSnapshotOnSuccess: true,
          snapshotBackend: new MemorySnapshotBackend(replaySnapshot),
          snapshotIntervalMs: 0,
          snapshotPath
        }),
        `replay ${index + 1}`
      );

      if (!isDeepStrictEqual(replayReturnValue, originalReturnValue)) {
        throw new Error(
          [
            `Replay equivalence failed: non-deterministic return value from snapshot ${index + 1}/${snapshots.length}.`,
            `Original: ${formatValue(originalReturnValue)}`,
            `Replay: ${formatValue(replayReturnValue)}`
          ].join("\n")
        );
      }
    }
  } finally {
    await Promise.all([
      rm(snapshotPath, { force: true }),
      rm(hostCallStorePath, { force: true }),
      rm(`${snapshotPath}.tmp`, { force: true })
    ]);
  }
}

class MemorySnapshotBackend implements SnapshotBackend {
  readonly writes: Snapshot[] = [];

  constructor(private snapshot?: Snapshot) {}

  async read(): Promise<Snapshot | undefined> {
    return this.snapshot;
  }

  async write(snapshot: Snapshot): Promise<void> {
    const copy = copySnapshot(snapshot);
    this.writes.push(copy);
    this.snapshot = copy;
  }

  async remove(): Promise<void> {
    this.snapshot = undefined;
  }
}

function readReturnValue(result: RunResult, label: string): unknown {
  if (result.ok) {
    return result.returnValue;
  }

  throw new Error(`Cannot assert replay equivalence because the ${label} run failed.`);
}

function createDeterministicClock(): { now: () => number } {
  let next = 1_700_000_000_000;

  return {
    now() {
      const value = next;
      next += 1;
      return value;
    }
  };
}

async function createSnapshotPath(): Promise<string> {
  const tempRoot = os.tmpdir();
  await mkdir(tempRoot, { recursive: true });
  nextReplayId += 1;
  return join(tempRoot, `poe-harness-replay-${process.pid}-${nextReplayId}.json`);
}

async function readOptionalTextFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

async function restoreOptionalTextFile(path: string, content: string | undefined): Promise<void> {
  if (content === undefined) {
    await rm(path, { force: true });
    return;
  }

  await writeFile(path, content);
}

function copySnapshot(snapshot: Snapshot): Snapshot {
  return JSON.parse(JSON.stringify(snapshot)) as Snapshot;
}

function formatValue(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return hasOwnErrorCode(error, code);
}
