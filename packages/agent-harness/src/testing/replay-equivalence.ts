import { joinPath as join } from "@poe-code/safe-fs/runtime-core";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import isEqual from "lodash-es/isEqual.js";
import { hostEnvironment } from "#harness-platform";
import { harnessFileSystem, type HarnessFileSystem } from "../filesystem.js";

import type { Snapshot, SnapshotBackend } from "@poe-code/safe-js";

import { hasOwnErrorCode } from "../error-codes.js";
import { runHarnessPair, type RunHarnessPairOptions, type RunResult } from "../loader/run.js";

type ModulesFor = RunHarnessPairOptions["modulesFor"];

export type ReplayEquivalenceOptions = { fs?: FileSystem; temporaryDirectory?: string };

export async function assertReplayEquivalent(path: string, modulesFor: ModulesFor, options: ReplayEquivalenceOptions = {}): Promise<void> {
  const fs = harnessFileSystem(options.fs);
  const snapshotPath = await createSnapshotPath(fs, options.temporaryDirectory);
  const hostCallStorePath = `${snapshotPath}.host-calls.json`;
  const originalBackend = new MemorySnapshotBackend();

  try {
    const original = await runHarnessPair(path, {
      fs: options.fs,
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
    const originalHostCalls = await readOptionalTextFile(hostCallStorePath, fs);
    const snapshots = [...originalBackend.writes, original.snapshot];

    for (let index = 0; index < snapshots.length; index += 1) {
      const replaySnapshot = snapshots[index];
      await restoreOptionalTextFile(hostCallStorePath, originalHostCalls, fs);
      const replayReturnValue = readReturnValue(
        await runHarnessPair(path, {
          fs: options.fs,
          clock: createDeterministicClock(),
          modulesFor,
          preserveSnapshotOnSuccess: true,
          snapshotBackend: new MemorySnapshotBackend(replaySnapshot),
          snapshotIntervalMs: 0,
          snapshotPath
        }),
        `replay ${index + 1}`
      );

      if (!isEqual(replayReturnValue, originalReturnValue)) {
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
      fs.rm(snapshotPath, { force: true }),
      fs.rm(hostCallStorePath, { force: true }),
      fs.rm(`${snapshotPath}.tmp`, { force: true })
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

async function createSnapshotPath(fs: HarnessFileSystem, directory?: string): Promise<string> {
  const tempRoot = directory ?? hostEnvironment.tmpdir();
  await fs.mkdir(tempRoot, { recursive: true });
  return join(tempRoot, `poe-harness-replay-${crypto.randomUUID()}.json`);
}

async function readOptionalTextFile(path: string, fs: HarnessFileSystem): Promise<string | undefined> {
  try {
    return await fs.readFile(path, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

async function restoreOptionalTextFile(path: string, content: string | undefined, fs: HarnessFileSystem): Promise<void> {
  if (content === undefined) {
    await fs.rm(path, { force: true });
    return;
  }

  await fs.writeFile(path, content);
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
