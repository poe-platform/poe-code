import { describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import { createCliContainer } from "../container.js";
import { registerVersionOption } from "./version.js";
import { VersionExit } from "../exit-signals.js";
import type { FileSystem } from "../../utils/file-system.js";
import type { HttpClient } from "../http.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  vol.mkdirSync(cwd, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function createHttpClient(latestVersion: string): HttpClient {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ "dist-tags": { latest: latestVersion } })
  }));
}

async function runVersion(options: {
  currentVersion: string;
  httpClient: HttpClient;
  variables?: Record<string, string | undefined>;
}): Promise<string[]> {
  const logs: string[] = [];
  const container = createCliContainer({
    fs: createMemFs(),
    prompts: async () => ({}),
    env: { cwd, homeDir, variables: options.variables ?? {} },
    logger: (message) => logs.push(message),
    httpClient: options.httpClient
  });

  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.action(() => {});
  registerVersionOption(program, container, options.currentVersion);

  await program.parseAsync(["node", "cli", "--version"]).catch((error: unknown) => {
    if (!(error instanceof VersionExit)) {
      throw error;
    }
  });

  return logs;
}

describe("version option", () => {
  it("does not nag a local dev build about published releases", async () => {
    const httpClient = createHttpClient("4.0.0");

    const logs = await runVersion({ currentVersion: "0.0.0-dev", httpClient });

    expect(logs.join("\n")).not.toContain("Update available");
    expect(logs.join("\n")).not.toContain("poe-code@latest");
    expect(httpClient).not.toHaveBeenCalled();
  });

  it("suggests the upgrade command matching the detected install", async () => {
    const logs = await runVersion({
      currentVersion: "3.9.0",
      httpClient: createHttpClient("4.0.0"),
      variables: { npm_config_user_agent: "pnpm/9.0.0 npm/? node/v22" }
    });

    expect(logs.join("\n")).toContain("Update available: 3.9.0 -> 4.0.0");
    expect(logs.join("\n")).toContain("pnpm add -g poe-code@latest");
  });
});
