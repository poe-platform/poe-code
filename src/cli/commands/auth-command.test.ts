import { describe, it, expect, beforeEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";
import type { FileSystem } from "../utils/file-system.js";
import type { HttpClient } from "../http.js";
import { ApiError } from "../errors.js";

const cwd = "/repo";
const homeDir = "/home/test";
const configPath = `${homeDir}/.poe-code/config.json`;
const credentialsPath = `${homeDir}/.poe-code/credentials.json`;

function createMemfs(): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function createConfigVolume(input: {
  apiKey?: string;
  configuredServices?: Record<string, { files: string[] }>;
}): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(`${homeDir}/.poe-code`, { recursive: true });

  if (input.configuredServices) {
    volume.writeFileSync(
      configPath,
      `${JSON.stringify({ configured_services: input.configuredServices }, null, 2)}\n`
    );
  }

  if (input.apiKey) {
    volume.writeFileSync(
      credentialsPath,
      `${JSON.stringify({ apiKey: input.apiKey }, null, 2)}\n`
    );
  }

  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

describe("auth command", () => {
  let fs: FileSystem;
  let logs: string[];
  let httpClient: HttpClient;

  beforeEach(() => {
    fs = createMemfs();
    logs = [];
    httpClient = vi.fn();
  });

  it("shows logged-in status, balance, and configured agent", async () => {
    fs = createConfigVolume({
      apiKey: "test-key",
      configuredServices: {
        "claude-code": { files: ["/tmp/settings.json"] }
      }
    });
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ current_point_balance: 1500 })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "auth", "status"]);

    expect(httpClient).toHaveBeenCalledWith(
      expect.stringContaining("/usage/current_balance"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key"
        })
      })
    );
    expect(logs.some((m) => m.includes("Logged in"))).toBe(true);
    expect(logs.some((m) => m.includes("Current balance: 1,500 points"))).toBe(true);
    expect(logs.some((m) => m.includes("Configured agents: claude-code"))).toBe(true);
  });

  it("shows not logged in and no configured agents when no config exists", async () => {
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "auth", "status"]);

    expect(httpClient).not.toHaveBeenCalled();
    expect(logs.some((m) => m.includes("Not logged in"))).toBe(true);
    expect(logs.some((m) => m.includes("No agents configured"))).toBe(true);
  });

  it("lists configured agents even when not logged in", async () => {
    fs = createConfigVolume({
      configuredServices: {
        codex: { files: ["/tmp/config.toml"] }
      }
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "auth", "status"]);

    expect(httpClient).not.toHaveBeenCalled();
    expect(logs.some((m) => m.includes("Not logged in"))).toBe(true);
    expect(logs.some((m) => m.includes("Configured agents: codex"))).toBe(true);
  });

  it("skips balance API call in dry-run mode", async () => {
    fs = createConfigVolume({
      apiKey: "test-key"
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message),
      exitOverride: true
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: true } as any);

    await program.parseAsync(["node", "cli", "--dry-run", "auth", "status"]);

    expect(httpClient).not.toHaveBeenCalled();
    expect(logs.some((m) => m.includes("Dry run"))).toBe(true);
  });

  it("throws ApiError when balance request fails", async () => {
    fs = createConfigVolume({
      apiKey: "test-key"
    });
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({})
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await expect(
      program.parseAsync(["node", "cli", "auth", "status"])
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("lists multiple configured agents", async () => {
    fs = createConfigVolume({
      apiKey: "test-key",
      configuredServices: {
        codex: { files: ["/tmp/config.toml"] },
        "claude-code": { files: ["/tmp/settings.json"] }
      }
    });
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ current_point_balance: 900 })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "auth", "status"]);

    expect(
      logs.some((m) => m.includes("Configured agents:") && m.includes("claude-code") && m.includes("codex"))
    ).toBe(true);
  });

  it("runs status when auth is invoked without subcommand", async () => {
    fs = createConfigVolume({
      apiKey: "test-key"
    });
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ current_point_balance: 321 })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "auth"]);

    expect(httpClient).toHaveBeenCalledWith(
      expect.stringContaining("/usage/current_balance"),
      expect.any(Object)
    );
    expect(logs.some((m) => m.includes("Current balance: 321 points"))).toBe(true);
  });

  it("shows stored API key with auth api_key", async () => {
    fs = createConfigVolume({
      apiKey: "stored-key"
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    await program.parseAsync(["node", "cli", "auth", "api_key"]);

    expect(logs.some((m) => m.includes("API key: stored-key"))).toBe(true);
  });

  it("shows no API key message with auth api_key when key is missing", async () => {
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    await program.parseAsync(["node", "cli", "auth", "api_key"]);

    expect(logs.some((m) => m.includes("No API key stored"))).toBe(true);
  });
});
