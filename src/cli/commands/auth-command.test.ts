import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";
import type { FileSystem } from "../utils/file-system.js";
import type { HttpClient } from "../http.js";
import { ApiError } from "../errors.js";
import { createCliContainer } from "../container.js";
import { storeTestApiKey } from "../../../tests/test-helpers.js";

const spinnerStopMessages: string[] = [];
const spinnerMock = vi.hoisted(() => vi.fn());

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    spinner: spinnerMock
  };
});

const cwd = "/repo";
const homeDir = "/home/test";

function createMemfs(): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

async function storeApiKey(fs: FileSystem, apiKey: string): Promise<void> {
  const container = createCliContainer({
    fs,
    prompts: vi.fn(),
    env: { cwd, homeDir }
  });
  await container.writeApiKey(apiKey);
}

function createBalanceResponse(balance = 8_432) {
  return { current_point_balance: balance };
}

describe("auth command", () => {
  let fs: FileSystem;
  let logs: string[];
  let httpClient: HttpClient;
  let originalPoeApiKey: string | undefined;

  beforeEach(() => {
    originalPoeApiKey = process.env.POE_API_KEY;
    delete process.env.POE_API_KEY;
    fs = createMemfs();
    logs = [];
    httpClient = vi.fn();
    spinnerStopMessages.length = 0;
    spinnerMock.mockReturnValue({
      start: vi.fn(),
      stop: (msg: string) => {
        spinnerStopMessages.push(msg);
      }
    });
  });

  afterEach(() => {
    if (originalPoeApiKey === undefined) {
      delete process.env.POE_API_KEY;
    } else {
      process.env.POE_API_KEY = originalPoeApiKey;
    }
  });

  it("shows logged in after checking the usage endpoint", async () => {
    await storeApiKey(fs, "test-key");

    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => createBalanceResponse()
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
    expect(spinnerStopMessages).toContain("Logged in");
  });

  it("checks POE_API_KEY without stored credentials", async () => {
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => createBalanceResponse(500)
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: { POE_API_KEY: "environment-key" } },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "auth", "status"]);

    expect(httpClient).toHaveBeenCalledWith(
      expect.stringContaining("/usage/current_balance"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer environment-key" })
      })
    );
    expect(spinnerStopMessages).toContain("Logged in");
  });

  it("shows not logged in when no API key exists", async () => {
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
  });

  it("skips whoami API call in dry-run mode", async () => {
    await storeApiKey(fs, "test-key");

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

  it("does not migrate legacy credentials while previewing auth status", async () => {
    await storeTestApiKey(fs, homeDir, "legacy-key");

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message),
      exitOverride: true
    });

    await program.parseAsync(["node", "cli", "--dry-run", "auth", "status"]);

    await expect(fs.readdir(`${homeDir}/.poe-code`)).resolves.toEqual(["credentials.enc"]);
  });

  it("throws ApiError when the credential check fails", async () => {
    await storeApiKey(fs, "test-key");

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

    await expect(program.parseAsync(["node", "cli", "auth", "status"])).rejects.toBeInstanceOf(
      ApiError
    );
  });

  it("runs status when auth is invoked without subcommand", async () => {
    await storeApiKey(fs, "test-key");

    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => createBalanceResponse()
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
    expect(spinnerStopMessages).toContain("Logged in");
  });

  it("shows feedback outro after status output", async () => {
    await storeApiKey(fs, "test-key");

    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => createBalanceResponse()
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

    expect(logs.some((m) => m.includes("Problems?"))).toBe(true);
  });

  it("shows feedback outro when not logged in", async () => {
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "auth", "status"]);

    expect(logs.some((m) => m.includes("Problems?"))).toBe(true);
  });

  it("prints auth status as JSON with --json and skips human log lines", async () => {
    await storeApiKey(fs, "test-key");

    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => createBalanceResponse()
    });

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "auth", "status", "--json"]);

    const written = stdoutSpy.mock.calls.map((call) => call[0]).join("");
    stdoutSpy.mockRestore();

    expect(JSON.parse(written)).toEqual({ loggedIn: true });
    expect(logs).toEqual([]);
    expect(spinnerStopMessages).toEqual([]);
  });

  it("reports logged in when whoami rejects a valid external user's key", async () => {
    await storeApiKey(fs, "valid-external-key");

    (httpClient as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init) => {
      if (url !== "https://api.poe.com/usage/current_balance" || init?.method !== "GET") {
        throw new Error(`Unexpected request: ${init?.method} ${url}`);
      }
      return { ok: true, status: 200, json: async () => createBalanceResponse(1_250) };
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

    expect(httpClient).toHaveBeenCalledOnce();
    expect(spinnerStopMessages).toContain("Logged in");
  });

  it("reports logged-out state as JSON with auth status --json", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "auth", "status", "--json"]);

    const written = stdoutSpy.mock.calls.map((call) => call[0]).join("");
    stdoutSpy.mockRestore();

    expect(httpClient).not.toHaveBeenCalled();
    expect(JSON.parse(written)).toEqual({ loggedIn: false });
    expect(logs).toEqual([]);
  });

  it("does not fetch identity for auth status --json while previewing", async () => {
    await storeApiKey(fs, "test-key");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message),
      exitOverride: true
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: true } as any);

    await program.parseAsync(["node", "cli", "--dry-run", "auth", "status", "--json"]);

    const written = stdoutSpy.mock.calls.map((call) => call[0]).join("");
    stdoutSpy.mockRestore();

    expect(httpClient).not.toHaveBeenCalled();
    expect(JSON.parse(written)).toEqual({ loggedIn: true, dryRun: true });
    expect(logs).toEqual([]);
  });

  it("documents --json on auth status help", async () => {
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const statusCommand = program.commands
      .find((command) => command.name() === "auth")
      ?.commands.find((command) => command.name() === "status");

    expect(statusCommand?.helpInformation()).toContain("--json");
  });

  it("masks the stored API key by default with auth api-key", async () => {
    await storeApiKey(fs, "poe-secret-abcd");

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    await program.parseAsync(["node", "cli", "auth", "api-key"]);

    const written = stdoutSpy.mock.calls.map((call) => call[0]).join("");
    expect(written).not.toContain("poe-secret-abcd");
    expect(written).toContain("abcd");
    expect(written.trim().startsWith("*")).toBe(true);
    stdoutSpy.mockRestore();
  });

  it("hints at --reveal when masking the API key", async () => {
    await storeApiKey(fs, "poe-secret-abcd");

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    await program.parseAsync(["node", "cli", "auth", "api-key"]);

    expect(logs.some((message) => message.includes("--reveal"))).toBe(true);
    expect(logs.some((message) => message.includes("poe-secret-abcd"))).toBe(false);
    stdoutSpy.mockRestore();
  });

  it("outputs the raw API key with auth api-key --reveal", async () => {
    await storeApiKey(fs, "stored-key");

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    await program.parseAsync(["node", "cli", "auth", "api-key", "--reveal"]);

    expect(stdoutSpy).toHaveBeenCalledWith("stored-key");
    stdoutSpy.mockRestore();
  });

  it("never prints the API key while previewing auth api-key --reveal", async () => {
    await storeApiKey(fs, "stored-key");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    await program.parseAsync(["node", "cli", "--dry-run", "auth", "api-key", "--reveal"]);

    const written = stdoutSpy.mock.calls.map((call) => call[0]).join("");
    expect(written).not.toContain("stored-key");
    expect(logs.some((message) => message.includes("stored-key"))).toBe(false);
    expect(logs.some((message) => message.includes("Dry run"))).toBe(true);
    stdoutSpy.mockRestore();
  });

  it("does not migrate legacy credentials while previewing auth api-key", async () => {
    await storeTestApiKey(fs, homeDir, "legacy-key");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    await program.parseAsync(["node", "cli", "--dry-run", "auth", "api-key"]);

    const written = stdoutSpy.mock.calls.map((call) => call[0]).join("");
    expect(written).not.toContain("legacy-key");
    await expect(fs.readdir(`${homeDir}/.poe-code`)).resolves.toEqual(["credentials.enc"]);
    stdoutSpy.mockRestore();
  });

  it("keeps auth api_key working as a compatibility alias with --reveal", async () => {
    await storeApiKey(fs, "stored-key");

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    await program.parseAsync(["node", "cli", "auth", "api_key", "--reveal"]);

    expect(stdoutSpy).toHaveBeenCalledWith("stored-key");
    stdoutSpy.mockRestore();
  });

  it("documents the secret danger and --reveal in auth api-key help", async () => {
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const apiKeyCommand = program.commands
      .find((command) => command.name() === "auth")
      ?.commands.find((command) => command.name() === "api-key");

    expect(apiKeyCommand?.description().toLowerCase()).toContain("danger");
    expect(apiKeyCommand?.helpInformation()).toContain("--reveal");
  });

  it("states the full blast radius on auth logout and distinguishes it from root logout", async () => {
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const authLogout = program.commands
      .find((command) => command.name() === "auth")
      ?.commands.find((command) => command.name() === "logout");
    const rootLogout = program.commands.find((command) => command.name() === "logout");

    expect(authLogout?.description()).toContain("ALL configured agents");
    expect(authLogout?.description().toLowerCase()).toContain("danger");
    expect(rootLogout?.description()).toContain("ALL configured agents");
    expect(authLogout?.description()).not.toBe(rootLogout?.description());
    expect(authLogout?.description()).toContain("poe-code logout");
  });

  it("documents POE_API_KEY as the preferred path on auth login --api-key help", async () => {
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const loginCommand = program.commands
      .find((command) => command.name() === "auth")
      ?.commands.find((command) => command.name() === "login");
    const help = loginCommand?.helpInformation() ?? "";

    expect(help).toContain("POE_API_KEY");
    expect(help).toMatch(/shell history/i);
  });

  it("sets exit code 1 when no API key is stored", async () => {
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    process.exitCode = 0;
    await program.parseAsync(["node", "cli", "auth", "api-key"]);

    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
