import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import type { SessionEntry } from "./entry-types.js";
import { createJsonlSessionStore, createMemorySessionStore } from "./session-store.js";

const entry: SessionEntry = {
  kind: "user",
  id: "entry-1",
  parentId: null,
  createdAt: "2026-06-13T00:00:00.000Z",
  text: "hello"
};

describe("session stores", () => {
  it("keeps memory entries isolated from caller mutation", async () => {
    const store = createMemorySessionStore("session-1");

    await store.append(entry);
    const listed = await store.list();
    listed[0] = { ...entry, id: "mutated" };

    await expect(store.list()).resolves.toEqual([entry]);
  });

  it("appends JSONL entries and replays them in order", async () => {
    const volume = new Volume();
    const fs = createFsFromVolume(volume).promises;
    const directory = "/sessions";
    const store = await createJsonlSessionStore("session-1", directory, { fs });
    const assistant: SessionEntry = {
      kind: "assistant",
      id: "entry-2",
      parentId: "entry-1",
      createdAt: "2026-06-13T00:00:01.000Z",
      text: "hi"
    };

    await store.append(entry);
    await store.append(assistant);

    await expect(store.list()).resolves.toEqual([entry, assistant]);
    expect(volume.readFileSync(path.join(directory, "session-1.jsonl"), "utf8")).toBe(
      `${JSON.stringify(entry)}\n${JSON.stringify(assistant)}\n`
    );
  });

  it("discards a trailing partial JSONL line on replay", async () => {
    const volume = new Volume();
    const fs = createFsFromVolume(volume).promises;
    const directory = "/sessions";
    volume.mkdirSync(directory, { recursive: true });
    volume.writeFileSync(
      path.join(directory, "session-1.jsonl"),
      `${JSON.stringify(entry)}\n{"kind":`
    );

    const store = await createJsonlSessionStore("session-1", directory, { fs });

    await expect(store.list()).resolves.toEqual([entry]);
  });

  it("rejects malformed complete JSONL lines with file and line context", async () => {
    const volume = new Volume();
    const fs = createFsFromVolume(volume).promises;
    const directory = "/sessions";
    const filePath = path.join(directory, "session-1.jsonl");
    const assistant: SessionEntry = {
      kind: "assistant",
      id: "entry-2",
      parentId: "entry-1",
      createdAt: "2026-06-13T00:00:01.000Z",
      text: "hi"
    };
    volume.mkdirSync(directory, { recursive: true });
    volume.writeFileSync(filePath, `${JSON.stringify(entry)}\n{broken json\n${JSON.stringify(assistant)}\n`);

    const store = await createJsonlSessionStore("session-1", directory, { fs });

    await expect(store.list()).rejects.toThrow(`Unable to parse poe-agent session entry at ${filePath}:2`);
  });

  it("rejects JSONL entries with unknown kinds", async () => {
    const volume = new Volume();
    const fs = createFsFromVolume(volume).promises;
    const directory = "/sessions";
    volume.mkdirSync(directory, { recursive: true });
    volume.writeFileSync(
      path.join(directory, "session-1.jsonl"),
      `${JSON.stringify({ ...entry, kind: "unknown" })}\n`
    );

    const store = await createJsonlSessionStore("session-1", directory, { fs });

    await expect(store.list()).rejects.toThrow("Invalid poe-agent session entry");
  });

  it.each(["", "   ", ".", "..", "../outside", "nested/session", "nested\\session"])(
    "rejects unsafe JSONL session id %j",
    async (sessionId) => {
      const volume = new Volume();
      const fs = createFsFromVolume(volume).promises;

      await expect(createJsonlSessionStore(sessionId, "/sessions", { fs })).rejects.toThrow(
        "Invalid poe-agent session id"
      );
    }
  );

  it.each(["", "   ", ".", "..", "../outside", "nested/session", "nested\\session"])(
    "rejects unsafe memory session id %j",
    (sessionId) => {
      expect(() => createMemorySessionStore(sessionId)).toThrow("Invalid poe-agent session id");
    }
  );
});
