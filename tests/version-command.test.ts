import { describe, it, expect, vi, beforeEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { CommanderError } from "commander";
import { createProgram } from "../src/cli/program.js";
import type { FileSystem } from "../src/utils/file-system.js";
import type { HttpClient } from "../src/cli/http.js";

function createMemfs(homeDir: string): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

async function parseWithVersionExit(
  program: ReturnType<typeof createProgram>,
  args: string[]
): Promise<void> {
  try {
    await program.parseAsync(args);
  } catch (error) {
    if (
      error instanceof CommanderError &&
      error.code === "commander.version" &&
      error.exitCode === 0
    ) {
      return;
    }
    throw error;
  }
}

describe("version command", () => {
  const cwd = "/repo";
  const homeDir = "/home/test";
  let fs: FileSystem;
  let logs: string[];
  let prompts: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fs = createMemfs(homeDir);
    logs = [];
    prompts = vi.fn();
  });

  it("displays current version", async () => {
    const httpClient: HttpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ "dist-tags": { latest: "1.0.0" } })
    }));

    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => {
        logs.push(message);
      }
    });

    await parseWithVersionExit(program, ["node", "cli", "--version"]);

    expect(logs.some((log) => log.includes("poe-code"))).toBe(true);
  });

  it("shows update available message when newer version exists", async () => {
    const httpClient: HttpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ "dist-tags": { latest: "99.0.0" } })
    }));

    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => {
        logs.push(message);
      }
    });

    await parseWithVersionExit(program, ["node", "cli", "--version"]);

    expect(logs.some((log) => log.includes("99.0.0"))).toBe(true);
    expect(logs.some((log) => log.includes("npm install -g poe-code"))).toBe(
      true
    );
  });

  it("does not show update message when version is current", async () => {
    const httpClient: HttpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ "dist-tags": { latest: "0.0.0-dev" } })
    }));

    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => {
        logs.push(message);
      }
    });

    await parseWithVersionExit(program, ["node", "cli", "--version"]);

    expect(
      logs.some((log) => log.includes("npm install -g poe-code"))
    ).toBe(false);
  });

  it("handles update check failure gracefully", async () => {
    const httpClient: HttpClient = vi.fn(async () => {
      throw new Error("Network error");
    });

    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => {
        logs.push(message);
      }
    });

    await parseWithVersionExit(program, ["node", "cli", "--version"]);

    expect(logs.some((log) => log.includes("poe-code"))).toBe(true);
    expect(logs.some((log) => log.includes("Network error"))).toBe(false);
  });
});
