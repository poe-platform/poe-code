import { beforeEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";
import type { FileSystem } from "../../utils/file-system.js";
import type { HttpClient } from "../http.js";

const withSpinnerMock = vi.hoisted(() =>
  vi.fn(async <T>({ fn }: { fn: () => Promise<T> }) => await fn())
);

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    withSpinner: withSpinnerMock
  };
});

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

describe("update command", () => {
  beforeEach(() => {
    withSpinnerMock.mockClear();
  });

  it("registers update in the root command and root help", () => {
    const program = createProgram({
      fs: createMemFs(),
      prompts: async () => ({}),
      env: { cwd, homeDir },
      logger: () => {},
      exitOverride: true,
      suppressCommanderOutput: true
    });

    expect(program.commands.find((command) => command.name() === "update")).toBeDefined();
    expect(program.helpInformation()).toContain("update");
  });

  it("prints the planned installer command during dry runs", async () => {
    const logs: string[] = [];
    const commandRunner = vi.fn();
    const program = createProgram({
      fs: createMemFs(),
      prompts: async () => ({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message),
      commandRunner
    });

    await program.parseAsync(["node", "cli", "--dry-run", "update"]);

    expect(commandRunner).not.toHaveBeenCalled();
    expect(withSpinnerMock).not.toHaveBeenCalled();
    expect(logs).toContain("Dry run: would run npm install -g poe-code@latest.");
  });

  it("runs the detected package manager inside a spinner", async () => {
    const logs: string[] = [];
    const commandRunner = vi.fn(async () => ({ exitCode: 0, stdout: "updated", stderr: "" }));
    const program = createProgram({
      fs: createMemFs(),
      prompts: async () => ({}),
      env: {
        cwd,
        homeDir,
        variables: { npm_config_user_agent: "bun/1.2.0 npm/? node/v22" }
      },
      logger: (message) => logs.push(message),
      commandRunner,
      httpClient: createHttpClient("99.0.0")
    });

    await program.parseAsync(["node", "cli", "update"]);

    expect(withSpinnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Updating poe-code...",
        fn: expect.any(Function)
      })
    );
    expect(commandRunner).toHaveBeenCalledWith(
      "bun",
      ["install", "-g", "poe-code@latest"],
      undefined
    );
    expect(logs).toContain("Updated poe-code to 99.0.0.");
  });

  it("supports overriding package manager detection", async () => {
    const commandRunner = vi.fn(async () => ({ exitCode: 0, stdout: "updated", stderr: "" }));
    const program = createProgram({
      fs: createMemFs(),
      prompts: async () => ({}),
      env: {
        cwd,
        homeDir,
        variables: { npm_config_user_agent: "bun/1.2.0 npm/? node/v22" }
      },
      logger: () => {},
      commandRunner,
      httpClient: createHttpClient("99.0.0")
    });

    await program.parseAsync(["node", "cli", "update", "--package-manager", "npm"]);

    expect(commandRunner).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "poe-code@latest"],
      undefined
    );
  });
});
