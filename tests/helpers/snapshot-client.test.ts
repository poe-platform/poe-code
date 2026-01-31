import { describe, it, expect, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import {
  createSnapshotClient,
  generateSnapshotKey,
  SnapshotMissingError
} from "./snapshot-client.js";
import type { FileSystem } from "../src/utils/file-system.js";
import type { LlmClient } from "../src/services/llm-client.js";

function createMemfs(): FileSystem {
  const volume = new Volume();
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

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
    const snapshotDir = "/__snapshots__";
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
    const snapshotDir = "/__snapshots__";
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
    const saved = JSON.parse(await fs.readFile(snapshotPath, "utf8") as string);

    expect(saved.response).toEqual(expectedResponse);
    expect(saved.metadata.recordedAt).toBe("2026-01-15T12:00:00.000Z");
    expect(saved.metadata.model).toBe(model);
  });

  it("throws on missing snapshots when configured", async () => {
    const fs = createMemfs();
    const snapshotDir = "/__snapshots__";
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

  it("falls back to base client on miss with passthrough mode", async () => {
    const fs = createMemfs();
    const snapshotDir = "/__snapshots__";
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
    const snapshotDir = "/__snapshots__";
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
