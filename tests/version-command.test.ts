import { describe, it, expect, vi, beforeEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createRequire } from "node:module";
import { createProgram } from "../src/cli/program.js";
import type { FileSystem } from "../src/utils/file-system.js";
import type { HttpClient } from "../src/cli/http.js";
import { SilentError } from "../src/cli/errors.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

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
    if (error instanceof SilentError) {
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
    expect(logs.some((log) => log.includes(packageJson.version))).toBe(true);
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
    expect(
      logs.some((log) => log.includes("npm install -g poe-code@latest"))
    ).toBe(true);
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
      logs.some((log) => log.includes("npm install -g poe-code@latest"))
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
