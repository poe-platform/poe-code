import { createMockFs } from "@poe-code/config-mutations/testing";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readDocument, writeScope } from "./store.js";

const homeDir = "/home/test";
const configPath = `${homeDir}/.poe-code/config.json`;

describe("store", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an empty document when config file is missing", async () => {
    const fs = createMockFs(undefined, homeDir);

    await expect(readDocument(fs, configPath)).resolves.toEqual({});
  });

  it("reads an existing scoped document", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            core: { apiKey: "stored-key" },
            configured_services: {
              codex: { files: ["/tmp/config.toml"] }
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await expect(readDocument(fs, configPath)).resolves.toEqual({
      core: { apiKey: "stored-key" },
      configured_services: {
        codex: { files: ["/tmp/config.toml"] }
      }
    });
  });

  it("backs up invalid JSON and resets the document", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-23T12:34:56.789Z"));

    const fs = createMockFs(
      {
        "~/.poe-code/config.json": "not json\n"
      },
      homeDir
    );

    await expect(readDocument(fs, configPath)).resolves.toEqual({});

    const directoryEntries = await fs.readdir(path.dirname(configPath));
    expect(directoryEntries).toContain(
      "config.json.invalid-2026-03-23T12-34-56-789Z.json"
    );
    expect(
      fs.getContent("~/.poe-code/config.json.invalid-2026-03-23T12-34-56-789Z.json")
    ).toBe("not json\n");
    expect(fs.getContent("~/.poe-code/config.json")).toBe("{}\n");
  });

  it("writes a scope while preserving unrelated scopes", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            core: { apiKey: "stored-key" },
            configured_services: {
              codex: { files: ["/tmp/config.toml"] }
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await writeScope(fs, configPath, "core", {
      apiKey: "updated-key",
      poeBaseUrl: "https://api.poe.com/v1"
    });

    expect(JSON.parse(fs.getContent("~/.poe-code/config.json") as string)).toEqual({
      core: {
        apiKey: "updated-key",
        poeBaseUrl: "https://api.poe.com/v1"
      },
      configured_services: {
        codex: { files: ["/tmp/config.toml"] }
      }
    });
  });

  it("removes a scope when writing an empty object", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            core: { apiKey: "stored-key" },
            configured_services: {
              codex: { files: ["/tmp/config.toml"] }
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await writeScope(fs, configPath, "configured_services", {});

    expect(JSON.parse(fs.getContent("~/.poe-code/config.json") as string)).toEqual({
      core: { apiKey: "stored-key" }
    });
  });
});
