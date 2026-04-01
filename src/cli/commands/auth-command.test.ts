import { describe, it, expect, beforeEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";
import type { FileSystem } from "../utils/file-system.js";
import type { HttpClient } from "../http.js";
import { ApiError } from "../errors.js";
import { createCliContainer } from "../container.js";

const spinnerStopMessages: string[] = [];
const spinnerMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
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

function createWhoamiResponse(overrides?: Partial<{
  user_id: number;
  handle: string;
  name: string;
  profile_picture: string;
}>) {
  return {
    user_id: overrides?.user_id ?? 12345,
    handle: overrides?.handle ?? "testuser",
    name: overrides?.name ?? "Test User",
    profile_picture: overrides?.profile_picture ?? "https://example.com/pic.jpg"
  };
}

describe("auth command", () => {
  let fs: FileSystem;
  let logs: string[];
  let httpClient: HttpClient;

  beforeEach(() => {
    fs = createMemfs();
    logs = [];
    httpClient = vi.fn();
    spinnerStopMessages.length = 0;
    spinnerMock.mockReturnValue({
      start: vi.fn(),
      stop: (msg: string) => { spinnerStopMessages.push(msg); }
    });
  });

  it("shows logged-in identity from whoami endpoint", async () => {
    await storeApiKey(fs, "test-key");

    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => createWhoamiResponse({ name: "Kamil Jopek", handle: "kamil" })
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
      expect.stringContaining("/whoami"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key"
        })
      })
    );
    expect(spinnerStopMessages.some((m) => m.includes("Logged in as Kamil Jopek (@kamil)"))).toBe(true);
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

  it("throws ApiError when whoami request fails", async () => {
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

    await expect(
      program.parseAsync(["node", "cli", "auth", "status"])
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("runs status when auth is invoked without subcommand", async () => {
    await storeApiKey(fs, "test-key");

    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => createWhoamiResponse({ name: "Test User", handle: "testuser" })
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
      expect.stringContaining("/whoami"),
      expect.any(Object)
    );
    expect(spinnerStopMessages.some((m) => m.includes("Logged in as Test User (@testuser)"))).toBe(true);
  });

  it("shows feedback outro after status output", async () => {
    await storeApiKey(fs, "test-key");

    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => createWhoamiResponse()
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

  it("shows stored API key with auth api_key", async () => {
    await storeApiKey(fs, "stored-key");

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
