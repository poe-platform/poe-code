import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { resolveGithubWorkflowAssetCopies } from "../../scripts/bundle-assets.mjs";
import {
  createSnapshotClient,
  generateSnapshotKey,
  SnapshotMissingError
} from "./snapshot-client.js";
import {
  listSnapshots,
  deleteSnapshots,
  refreshSnapshots,
  findStaleSnapshots,
  pruneSnapshots
} from "./snapshot-store.js";
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

describe("resolveGithubWorkflowAssetCopies", () => {
  it("includes prompts and workflow templates for the bundled github-workflows runtime", () => {
    const rootDir = path.join("/repo");

    expect(resolveGithubWorkflowAssetCopies(rootDir)).toEqual([
      {
        sourceDir: path.join("/repo", "packages", "github-workflows", "src", "prompts"),
        targetDir: path.join("/repo", "dist", "prompts"),
        extension: ".md"
      },
      {
        sourceDir: path.join("/repo", "packages", "github-workflows", "src", "workflow-templates"),
        targetDir: path.join("/repo", "dist", "workflow-templates"),
        extension: ".yml"
      }
    ]);
  });
});

describe("snapshot client", () => {
  it("generates stable keys for identical requests", () => {
    const request = {
      model: "Claude-Haiku-4.5",
      messages: [{ role: "user", content: "What is 2+2?" }]
    };

    const key1 = generateSnapshotKey(request);
    const key2 = generateSnapshotKey(request);
    const key3 = generateSnapshotKey({
      model: "Claude-Haiku-4.5",
      messages: [{ role: "user", content: "Different" }]
    });

    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key1).toMatch(/^claude-haiku-4-5-[a-f0-9]{12}$/);
  });

  it("plays back cached snapshots without calling base client", async () => {
    const fs = createMemfs();
    const snapshotDir = "/.snapshots";
    await fs.mkdir(snapshotDir, { recursive: true });

    const model = "Test-Model";
    const prompt = "Hello world";
    const cachedResponse = { content: "cached response" };

    const key = generateSnapshotKey({
      model,
      messages: [{ role: "user", content: prompt }]
    });

    await fs.writeFile(
      `${snapshotDir}/${key}.json`,
      JSON.stringify({
        key,
        request: { model, messages: [{ role: "user", content: prompt }] },
        response: cachedResponse,
        metadata: { recordedAt: "2026-01-01T00:00:00.000Z", model }
      })
    );

    const baseClient: LlmClient = {
      text: vi.fn(async () => ({ content: "live" })),
      media: vi.fn(async () => ({ url: "live" }))
    };

    const client = createSnapshotClient(baseClient, {
      mode: "playback",
      snapshotDir,
      onMiss: "error",
      fs
    });

    const response = await client.text({ model, prompt });

    expect(response).toEqual(cachedResponse);
    expect(baseClient.text).not.toHaveBeenCalled();
  });

  it("records snapshots when in record mode", async () => {
    const fs = createMemfs();
    const snapshotDir = "/.snapshots";
    await fs.mkdir(snapshotDir, { recursive: true });

    const model = "Test-Model";
    const prompt = "Test prompt";
    const expectedResponse = { content: "mocked response" };

    const baseClient: LlmClient = {
      text: vi.fn(async () => expectedResponse),
      media: vi.fn(async () => ({ url: "mocked" }))
    };

    const fixedDate = new Date("2026-01-15T12:00:00.000Z");
    const client = createSnapshotClient(baseClient, {
      mode: "record",
      snapshotDir,
      onMiss: "error",
      fs,
      now: () => fixedDate
    });

    const response = await client.text({ model, prompt });

    expect(response).toEqual(expectedResponse);
    expect(baseClient.text).toHaveBeenCalledWith({ model, prompt });

    const key = generateSnapshotKey({
      model,
      messages: [{ role: "user", content: prompt }]
    });
    const snapshotPath = `${snapshotDir}/${key}.json`;
    const saved = JSON.parse((await fs.readFile(snapshotPath, "utf8")) as string);

    expect(saved.response).toEqual(expectedResponse);
    expect(saved.metadata.recordedAt).toBe("2026-01-15T12:00:00.000Z");
    expect(saved.metadata.model).toBe(model);
  });

  it("throws on missing snapshots when configured", async () => {
    const fs = createMemfs();
    const snapshotDir = "/.snapshots";
    await fs.mkdir(snapshotDir, { recursive: true });

    const baseClient: LlmClient = {
      text: vi.fn(async () => ({ content: "live" })),
      media: vi.fn(async () => ({ url: "live" }))
    };

    const client = createSnapshotClient(baseClient, {
      mode: "playback",
      snapshotDir,
      onMiss: "error",
      fs
    });

    await expect(
      client.text({ model: "Test-Model", prompt: "nonexistent" })
    ).rejects.toBeInstanceOf(SnapshotMissingError);
    expect(baseClient.text).not.toHaveBeenCalled();
  });

  it("records snapshot on miss with record miss behavior", async () => {
    const fs = createMemfs();
    const snapshotDir = "/.snapshots";
    await fs.mkdir(snapshotDir, { recursive: true });

    const model = "Test-Model";
    const prompt = "not cached yet";
    const expectedResponse = { content: "live response" };

    const baseClient: LlmClient = {
      text: vi.fn(async () => expectedResponse),
      media: vi.fn(async () => ({ url: "live" }))
    };

    const fixedDate = new Date("2026-02-01T10:00:00.000Z");
    const client = createSnapshotClient(baseClient, {
      mode: "playback",
      snapshotDir,
      onMiss: "record",
      fs,
      now: () => fixedDate
    });

    const response = await client.text({ model, prompt });

    expect(response).toEqual(expectedResponse);
    expect(baseClient.text).toHaveBeenCalled();

    const key = generateSnapshotKey({
      model,
      messages: [{ role: "user", content: prompt }]
    });
    const snapshotPath = `${snapshotDir}/${key}.json`;
    const saved = JSON.parse((await fs.readFile(snapshotPath, "utf8")) as string);

    expect(saved.key).toBe(key);
    expect(saved.response).toEqual(expectedResponse);
    expect(saved.metadata.recordedAt).toBe("2026-02-01T10:00:00.000Z");
  });

  it("falls back to base client on miss with passthrough mode", async () => {
    const fs = createMemfs();
    const snapshotDir = "/.snapshots";
    await fs.mkdir(snapshotDir, { recursive: true });

    const expectedResponse = { content: "live response" };
    const baseClient: LlmClient = {
      text: vi.fn(async () => expectedResponse),
      media: vi.fn(async () => ({ url: "live" }))
    };

    const client = createSnapshotClient(baseClient, {
      mode: "playback",
      snapshotDir,
      onMiss: "passthrough",
      fs
    });

    const response = await client.text({
      model: "Test-Model",
      prompt: "not cached"
    });

    expect(response).toEqual(expectedResponse);
    expect(baseClient.text).toHaveBeenCalled();
  });

  it("tracks accessed keys during playback", async () => {
    const fs = createMemfs();
    const snapshotDir = "/.snapshots";
    await fs.mkdir(snapshotDir, { recursive: true });

    const model = "Test-Model";
    const prompt1 = "prompt one";
    const prompt2 = "prompt two";

    const key1 = generateSnapshotKey({
      model,
      messages: [{ role: "user", content: prompt1 }]
    });
    const key2 = generateSnapshotKey({
      model,
      messages: [{ role: "user", content: prompt2 }]
    });

    await fs.writeFile(
      `${snapshotDir}/${key1}.json`,
      JSON.stringify({
        key: key1,
        request: { model, messages: [{ role: "user", content: prompt1 }] },
        response: { content: "response 1" },
        metadata: { recordedAt: "2026-01-01T00:00:00.000Z", model }
      })
    );
    await fs.writeFile(
      `${snapshotDir}/${key2}.json`,
      JSON.stringify({
        key: key2,
        request: { model, messages: [{ role: "user", content: prompt2 }] },
        response: { content: "response 2" },
        metadata: { recordedAt: "2026-01-01T00:00:00.000Z", model }
      })
    );

    const baseClient: LlmClient = {
      text: vi.fn(async () => ({ content: "live" })),
      media: vi.fn(async () => ({ url: "live" }))
    };

    const client = createSnapshotClient(baseClient, {
      mode: "playback",
      snapshotDir,
      onMiss: "error",
      fs
    });

    expect(client.getAccessedKeys().size).toBe(0);

    await client.text({ model, prompt: prompt1 });
    expect(client.getAccessedKeys().has(key1)).toBe(true);
    expect(client.getAccessedKeys().size).toBe(1);

    await client.text({ model, prompt: prompt2 });
    expect(client.getAccessedKeys().has(key2)).toBe(true);
    expect(client.getAccessedKeys().size).toBe(2);
  });
});

describe("snapshot store", () => {
  it("lists snapshots with optional model filter", async () => {
    const fs = createMemfs();
    const snapshotDir = "/.snapshots";

    const modelA = "Model-A";
    const modelB = "Model-B";
    const keyA = await writeSnapshot(fs, snapshotDir, modelA, "prompt A", { content: "a" });
    const keyB = await writeSnapshot(fs, snapshotDir, modelB, "prompt B", { content: "b" });

    const all = await listSnapshots(fs, snapshotDir);
    const filteredA = await listSnapshots(fs, snapshotDir, { model: modelA });
    const filteredB = await listSnapshots(fs, snapshotDir, { model: modelB });

    expect(all).toHaveLength(2);
    expect(all.map((s) => s.key)).toContain(keyA);
    expect(all.map((s) => s.key)).toContain(keyB);

    expect(filteredA).toHaveLength(1);
    expect(filteredA[0].key).toBe(keyA);
    expect(filteredA[0].model).toBe(modelA);
    expect(filteredA[0].prompt).toBe("prompt A");

    expect(filteredB).toHaveLength(1);
    expect(filteredB[0].key).toBe(keyB);
  });

  it("deletes snapshots by model", async () => {
    const fs = createMemfs();
    const snapshotDir = "/.snapshots";

    const targetModel = "Model-Delete";
    const keepModel = "Model-Keep";
    const targetKey = await writeSnapshot(fs, snapshotDir, targetModel, "to delete", {
      content: "target"
    });
    const keepKey = await writeSnapshot(fs, snapshotDir, keepModel, "to keep", { content: "keep" });

    const deleted = await deleteSnapshots(fs, snapshotDir, { model: targetModel });

    expect(deleted).toBe(1);
    expect(await fileExists(fs, `${snapshotDir}/${targetKey}.json`)).toBe(false);
    expect(await fileExists(fs, `${snapshotDir}/${keepKey}.json`)).toBe(true);
  });

  it("deletes single snapshot by key", async () => {
    const fs = createMemfs();
    const snapshotDir = "/.snapshots";

    const key1 = await writeSnapshot(fs, snapshotDir, "Model", "prompt 1", { content: "1" });
    const key2 = await writeSnapshot(fs, snapshotDir, "Model", "prompt 2", { content: "2" });

    const deleted = await deleteSnapshots(fs, snapshotDir, { key: key1 });

    expect(deleted).toBe(1);
    expect(await fileExists(fs, `${snapshotDir}/${key1}.json`)).toBe(false);
    expect(await fileExists(fs, `${snapshotDir}/${key2}.json`)).toBe(true);
  });

  it("refreshes snapshots using the provided client", async () => {
    const fs = createMemfs();
    const snapshotDir = "/.snapshots";

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

    const updated = JSON.parse((await fs.readFile(`${snapshotDir}/${key}.json`, "utf8")) as string);
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
    const snapshotDir = "/.snapshots";

    const usedKey = await writeSnapshot(fs, snapshotDir, "Model-A", "used prompt", {
      content: "used"
    });
    const staleKey = await writeSnapshot(fs, snapshotDir, "Model-B", "stale prompt", {
      content: "stale"
    });

    const accessedKeys = new Set([usedKey]);
    const stale = await findStaleSnapshots(fs, snapshotDir, accessedKeys);

    expect(stale).toHaveLength(1);
    expect(stale[0]).toBe(staleKey);
  });

  it("returns empty array when all snapshots are accessed", async () => {
    const fs = createMemfs();
    const snapshotDir = "/.snapshots";

    const key1 = await writeSnapshot(fs, snapshotDir, "Model", "prompt 1", { content: "1" });
    const key2 = await writeSnapshot(fs, snapshotDir, "Model", "prompt 2", { content: "2" });

    const accessedKeys = new Set([key1, key2]);
    const stale = await findStaleSnapshots(fs, snapshotDir, accessedKeys);

    expect(stale).toHaveLength(0);
  });

  it("prunes stale snapshots and returns deleted keys", async () => {
    const fs = createMemfs();
    const snapshotDir = "/.snapshots";

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
