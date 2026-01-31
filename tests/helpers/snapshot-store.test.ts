import { describe, it, expect, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { generateSnapshotKey } from "./snapshot-client.js";
import { listSnapshots, deleteSnapshots, refreshSnapshots, findStaleSnapshots, pruneSnapshots } from "./snapshot-store.js";
import type { FileSystem } from "../../src/utils/file-system.js";
import type { LlmClient } from "../../src/services/llm-client.js";

function createMemfs(): FileSystem {
  const volume = new Volume();
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

async function writeSnapshot(
  fs: FileSystem,
  dir: string,
  modelName: string,
  prompt: string,
  response: { content?: string; url?: string }
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const request = {
    model: modelName,
    messages: [{ role: "user", content: prompt }],
    type: "text" as const
  };
  const key = generateSnapshotKey(request);
  const entry = {
    key,
    request,
    response,
    metadata: { recordedAt: "2026-01-28T12:00:00.000Z", model: modelName }
  };
  await fs.writeFile(`${dir}/${key}.json`, JSON.stringify(entry));
  return key;
}

async function fileExists(fs: FileSystem, filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("snapshot store", () => {
  it("lists snapshots with optional model filter", async () => {
    const fs = createMemfs();
    const snapshotDir = "/__snapshots__";

    const modelA = "Model-A";
    const modelB = "Model-B";
    const keyA = await writeSnapshot(fs, snapshotDir, modelA, "prompt A", { content: "a" });
    const keyB = await writeSnapshot(fs, snapshotDir, modelB, "prompt B", { content: "b" });

    const all = await listSnapshots(fs, snapshotDir);
    const filteredA = await listSnapshots(fs, snapshotDir, { model: modelA });
    const filteredB = await listSnapshots(fs, snapshotDir, { model: modelB });

    expect(all).toHaveLength(2);
    expect(all.map(s => s.key)).toContain(keyA);
    expect(all.map(s => s.key)).toContain(keyB);

    expect(filteredA).toHaveLength(1);
    expect(filteredA[0].key).toBe(keyA);
    expect(filteredA[0].model).toBe(modelA);
    expect(filteredA[0].prompt).toBe("prompt A");

    expect(filteredB).toHaveLength(1);
    expect(filteredB[0].key).toBe(keyB);
  });

  it("deletes snapshots by model", async () => {
    const fs = createMemfs();
    const snapshotDir = "/__snapshots__";

    const targetModel = "Model-Delete";
    const keepModel = "Model-Keep";
    const targetKey = await writeSnapshot(fs, snapshotDir, targetModel, "to delete", { content: "target" });
    const keepKey = await writeSnapshot(fs, snapshotDir, keepModel, "to keep", { content: "keep" });

    const deleted = await deleteSnapshots(fs, snapshotDir, { model: targetModel });

    expect(deleted).toBe(1);
    expect(await fileExists(fs, `${snapshotDir}/${targetKey}.json`)).toBe(false);
    expect(await fileExists(fs, `${snapshotDir}/${keepKey}.json`)).toBe(true);
  });

  it("deletes single snapshot by key", async () => {
    const fs = createMemfs();
    const snapshotDir = "/__snapshots__";

    const key1 = await writeSnapshot(fs, snapshotDir, "Model", "prompt 1", { content: "1" });
    const key2 = await writeSnapshot(fs, snapshotDir, "Model", "prompt 2", { content: "2" });

    const deleted = await deleteSnapshots(fs, snapshotDir, { key: key1 });

    expect(deleted).toBe(1);
    expect(await fileExists(fs, `${snapshotDir}/${key1}.json`)).toBe(false);
    expect(await fileExists(fs, `${snapshotDir}/${key2}.json`)).toBe(true);
  });

  it("refreshes snapshots using the provided client", async () => {
    const fs = createMemfs();
    const snapshotDir = "/__snapshots__";

    const model = "Test-Model";
    const prompt = "test prompt";
    const key = await writeSnapshot(fs, snapshotDir, model, prompt, { content: "old" });

    const mockClient: LlmClient = {
      text: vi.fn(async () => ({ content: "refreshed response" })),
      media: vi.fn(async () => ({ url: "refreshed" }))
    };

    const refreshed = await refreshSnapshots(fs, snapshotDir, {
      client: mockClient,
      key,
      now: () => new Date("2027-01-01T00:00:00.000Z")
    });

    expect(refreshed).toBe(1);
    expect(mockClient.text).toHaveBeenCalledWith({
      model,
      prompt,
      params: undefined
    });

    const updated = JSON.parse(await fs.readFile(`${snapshotDir}/${key}.json`, "utf8") as string);
    expect(updated.response).toEqual({ content: "refreshed response" });
    expect(updated.metadata.recordedAt).toBe("2027-01-01T00:00:00.000Z");
  });

  it("returns empty list for nonexistent directory", async () => {
    const fs = createMemfs();
    const result = await listSnapshots(fs, "/nonexistent");
    expect(result).toEqual([]);
  });

  it("finds stale snapshots not in accessed keys", async () => {
    const fs = createMemfs();
    const snapshotDir = "/__snapshots__";

    const usedKey = await writeSnapshot(fs, snapshotDir, "Model-A", "used prompt", { content: "used" });
    const staleKey = await writeSnapshot(fs, snapshotDir, "Model-B", "stale prompt", { content: "stale" });

    const accessedKeys = new Set([usedKey]);
    const stale = await findStaleSnapshots(fs, snapshotDir, accessedKeys);

    expect(stale).toHaveLength(1);
    expect(stale[0]).toBe(staleKey);
  });

  it("returns empty array when all snapshots are accessed", async () => {
    const fs = createMemfs();
    const snapshotDir = "/__snapshots__";

    const key1 = await writeSnapshot(fs, snapshotDir, "Model", "prompt 1", { content: "1" });
    const key2 = await writeSnapshot(fs, snapshotDir, "Model", "prompt 2", { content: "2" });

    const accessedKeys = new Set([key1, key2]);
    const stale = await findStaleSnapshots(fs, snapshotDir, accessedKeys);

    expect(stale).toHaveLength(0);
  });

  it("prunes stale snapshots and returns deleted keys", async () => {
    const fs = createMemfs();
    const snapshotDir = "/__snapshots__";

    const usedKey = await writeSnapshot(fs, snapshotDir, "Model", "used", { content: "used" });
    const staleKey = await writeSnapshot(fs, snapshotDir, "Model", "stale", { content: "stale" });

    const accessedKeys = new Set([usedKey]);
    const pruned = await pruneSnapshots(fs, snapshotDir, accessedKeys);

    expect(pruned).toHaveLength(1);
    expect(pruned[0]).toBe(staleKey);
    expect(await fileExists(fs, `${snapshotDir}/${staleKey}.json`)).toBe(false);
    expect(await fileExists(fs, `${snapshotDir}/${usedKey}.json`)).toBe(true);
  });
});
