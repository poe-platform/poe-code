import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { createAgentSessionStore } from "./session-store.js";

const homeDir = "/home/test";

function createStore() {
  const volume = new Volume();
  const fs = createFsFromVolume(volume).promises;
  return {
    store: createAgentSessionStore({ homeDir, fs }),
    volume
  };
}

describe("createAgentSessionStore", () => {
  it("saves and loads a session losslessly", async () => {
    const { store } = createStore();
    const session = {
      version: 1 as const,
      threadId: "poe-agent-thread",
      model: "openai/gpt-5.5",
      cwd: "/workspace",
      createdAt: "2026-06-12T12:00:00.000Z",
      updatedAt: "2026-06-12T12:01:00.000Z",
      messages: [
        { role: "user" as const, content: "remember zebra" },
        { role: "assistant" as const, content: "I will remember zebra" }
      ]
    };

    await store.save(session);

    await expect(store.load(session.threadId)).resolves.toEqual(session);
  });

  it("returns undefined for a missing session", async () => {
    const { store } = createStore();

    await expect(store.load("missing")).resolves.toBeUndefined();
  });

  it("reports corrupt JSON with its file path", async () => {
    const { store, volume } = createStore();
    const filePath = path.join(homeDir, ".poe-code", "sessions", "broken.json");
    volume.mkdirSync(path.dirname(filePath), { recursive: true });
    volume.writeFileSync(filePath, "not json");

    await expect(store.load("broken")).rejects.toThrow(filePath);
  });

  it("rejects unsupported session versions", async () => {
    const { store, volume } = createStore();
    const filePath = path.join(homeDir, ".poe-code", "sessions", "future.json");
    volume.mkdirSync(path.dirname(filePath), { recursive: true });
    volume.writeFileSync(filePath, JSON.stringify({ version: 2 }));

    await expect(store.load("future")).rejects.toThrow(
      /Unsupported poe-agent session version.*future\.json/
    );
  });
});
