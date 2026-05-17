import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentScriptSnapshot } from "../restore.js";

export type Snapshot = AgentScriptSnapshot;

export interface SnapshotBackend {
  read(): Promise<Snapshot | undefined>;
  write(snapshot: Snapshot): Promise<void>;
  remove(): Promise<void>;
}

export class FileSnapshotBackend implements SnapshotBackend {
  #pendingWrite = Promise.resolve();

  constructor(readonly path: string) {}

  async read(): Promise<Snapshot | undefined> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as Snapshot;
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        return undefined;
      }

      throw error;
    }
  }

  async write(snapshot: Snapshot): Promise<void> {
    const write = this.#pendingWrite.then(() => writeSnapshotAtomically(this.path, snapshot));
    this.#pendingWrite = write.catch(() => undefined);
    await write;
  }

  async remove(): Promise<void> {
    await this.#pendingWrite;
    try {
      await unlink(this.path);
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) {
        throw error;
      }
    }
  }
}

async function writeSnapshotAtomically(snapshotPath: string, snapshot: Snapshot): Promise<void> {
  const temporaryPath = `${snapshotPath}.tmp`;

  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeFile(temporaryPath, JSON.stringify(snapshot, null, 2));
  await rename(temporaryPath, snapshotPath);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
