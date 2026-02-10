import { describe, it, expect, beforeEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";
import type { FileSystem } from "../utils/file-system.js";
import type { HttpClient } from "../http.js";

const confirmMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() => vi.fn().mockReturnValue(false));
const getThemeMock = vi.hoisted(() => vi.fn());
const typographyMock = vi.hoisted(() => ({
  bold: vi.fn((t: string) => t),
  dim: vi.fn((t: string) => t),
  italic: vi.fn((t: string) => t),
  underline: vi.fn((t: string) => t),
  strikethrough: vi.fn((t: string) => t)
}));

function createIdentityTheme() {
  return {
    header: (t: string) => t,
    divider: (t: string) => t,
    prompt: (t: string) => t,
    number: (t: string) => t,
    intro: (t: string) => t,
    resolvedSymbol: "◇",
    errorSymbol: "■",
    accent: (t: string) => t,
    muted: (t: string) => t,
    success: (t: string) => t,
    warning: (t: string) => t,
    error: (t: string) => t,
    info: (t: string) => t
  };
}

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
  return {
    ...actual,
    confirm: confirmMock,
    isCancel: isCancelMock,
    getTheme: getThemeMock,
    typography: typographyMock
  };
});

const cwd = "/repo";
const homeDir = "/home/test";
const credentialsPath = `${homeDir}/.poe-code/credentials.json`;

function formatLocalDate(microseconds: number): string {
  const date = new Date(microseconds / 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function createMemfs(homeDir: string): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function createCredentialsVolume(apiKey: string): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(`${homeDir}/.poe-code`, { recursive: true });
  volume.writeFileSync(
    credentialsPath,
    JSON.stringify({ apiKey })
  );
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

describe("usage balance command", () => {
  let fs: FileSystem;
  let logs: string[];
  let httpClient: HttpClient;

  beforeEach(() => {
    fs = createMemfs(homeDir);
    logs = [];
    httpClient = vi.fn();
    getThemeMock.mockReset().mockReturnValue(createIdentityTheme());
  });

  it("fetches and displays current balance", async () => {
    fs = createCredentialsVolume("test-key");
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

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "balance"]);

    expect(httpClient).toHaveBeenCalledWith(
      expect.stringContaining("/usage/current_balance"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key"
        })
      })
    );
    expect(
      logs.some((message) => message.includes("Current balance: 1,500 points"))
    ).toBe(true);
    expect(
      logs.some((message) => message.includes("https://poe.com/api/keys"))
    ).toBe(true);
  });

  it("shows balance when invoked without subcommand", async () => {
    fs = createCredentialsVolume("test-key");
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

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage"]);

    expect(httpClient).toHaveBeenCalledWith(
      expect.stringContaining("/usage/current_balance"),
      expect.any(Object)
    );
    expect(
      logs.some((message) => message.includes("Current balance: 1,500 points"))
    ).toBe(true);
  });

  it("prompts for API key when not stored and uses it", async () => {
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ current_point_balance: 500 })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({ apiKey: "prompted-key" }),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "balance"]);

    expect(httpClient).toHaveBeenCalledWith(
      expect.stringContaining("/usage/current_balance"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer prompted-key"
        })
      })
    );
  });

  it("logs dry run message when --dry-run flag is set", async () => {
    fs = createCredentialsVolume("test-key");

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message),
      exitOverride: true
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: true } as any);

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "usage",
      "balance"
    ]);

    expect(httpClient).not.toHaveBeenCalled();
    expect(
      logs.some((message) => message.includes("Dry run"))
    ).toBe(true);
  });
});

describe("usage balance styling", () => {
  let fs: FileSystem;
  let logs: string[];
  let httpClient: HttpClient;

  beforeEach(() => {
    fs = createMemfs(homeDir);
    logs = [];
    httpClient = vi.fn();
    getThemeMock.mockReset().mockReturnValue(createIdentityTheme());
    typographyMock.bold.mockReset().mockImplementation((t: string) => t);
  });

  it("styles balance value with theme.accent", async () => {
    const accentFn = vi.fn((t: string) => t);
    getThemeMock.mockReturnValue({ ...createIdentityTheme(), accent: accentFn });

    fs = createCredentialsVolume("test-key");
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

    await program.parseAsync(["node", "cli", "usage", "balance"]);

    expect(accentFn).toHaveBeenCalledWith("1,500");
  });

  it("applies bold to the balance value", async () => {
    fs = createCredentialsVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ current_point_balance: 2500 })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "balance"]);

    expect(typographyMock.bold).toHaveBeenCalledWith("2,500");
  });

  it("uses logger.info for the balance line", async () => {
    fs = createCredentialsVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ current_point_balance: 750 })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "balance"]);

    expect(logs.some((m) => m.includes("Current balance:"))).toBe(true);
    expect(logs.some((m) => m.includes("750"))).toBe(true);
    expect(logs.some((m) => m.includes("points"))).toBe(true);
  });
});

describe("usage list command", () => {
  let fs: FileSystem;
  let logs: string[];
  let httpClient: HttpClient;

  beforeEach(() => {
    fs = createMemfs(homeDir);
    logs = [];
    httpClient = vi.fn();
    confirmMock.mockReset();
    isCancelMock.mockReset().mockReturnValue(false);
    getThemeMock.mockReset().mockReturnValue(createIdentityTheme());
  });

  it("fetches and displays usage history from GET /usage/points_history with limit=20", async () => {
    fs = createCredentialsVolume("test-key");
    const entries = [
      {
        query_id: "q1",
        creation_time: 1705314600000000,
        bot_name: "Claude-Sonnet-4.5",
        cost_usd: "0.0015",
        cost_points: -50,
        cost_breakdown_in_points: {
          Input: "10 points (500 tokens)",
          Output: "40 points (800 tokens)",
          Total: "50 points"
        }
      },
      {
        query_id: "q2",
        creation_time: 1705310100000000,
        bot_name: "gpt-5.2",
        cost_usd: "0.0009",
        cost_points: -30,
        cost_breakdown_in_points: {
          Input: "8 points (300 tokens)",
          Output: "22 points (400 tokens)",
          Cached: "0 points (100 tokens)",
          Total: "30 points"
        }
      }
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        has_more: false,
        length: 2,
        data: entries
      })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list"]);

    expect(httpClient).toHaveBeenCalledWith(
      expect.stringContaining("/usage/points_history?limit=20"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key"
        })
      })
    );

    const tableOutput = logs.join("\n");
    expect(tableOutput).toContain("Claude-Sonnet-4.5");
    expect(tableOutput).toContain("gpt-5.2");
    expect(tableOutput).toContain(formatLocalDate(1705314600000000));
    expect(tableOutput).toContain(formatLocalDate(1705310100000000));
    expect(tableOutput).toContain("$0.0015 (-50 points)");
    expect(tableOutput).toContain("$0.0009 (-30 points)");
    expect(tableOutput).toContain("10 points (500 tokens)");
    expect(tableOutput).toContain("40 points (800 tokens)");
    expect(tableOutput).toContain("8 points (300 tokens)");
    expect(tableOutput).toContain("22 points (400 tokens)");
    expect(tableOutput).toContain("0 points (100 tokens)");
  });

  it("prompts 'Load more?' when API returns has_more=true", async () => {
    fs = createCredentialsVolume("test-key");
    const page1Entries = [
      { query_id: "entry-1", creation_time: 1705314600000000, bot_name: "Claude-Sonnet-4.5", cost_usd: "0.0015", cost_points: -50 },
      { query_id: "entry-2", creation_time: 1705310100000000, bot_name: "gpt-5.2", cost_usd: "0.0009", cost_points: -30 }
    ];
    const page2Entries = [
      { query_id: "entry-3", creation_time: 1705240800000000, bot_name: "Claude-Opus", cost_usd: "0.003", cost_points: -100 }
    ];

    (httpClient as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ has_more: true, length: 2, data: page1Entries })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ has_more: false, length: 1, data: page2Entries })
      });

    confirmMock.mockResolvedValueOnce(true);

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list"]);

    expect(confirmMock).toHaveBeenCalledWith({ message: "Load more?" });

    expect(httpClient).toHaveBeenCalledTimes(2);
    expect(httpClient).toHaveBeenLastCalledWith(
      expect.stringContaining("starting_after=entry-2"),
      expect.any(Object)
    );

    const output = logs.join("\n");
    expect(output).toContain("Claude-Sonnet-4.5");
    expect(output).toContain("gpt-5.2");
    expect(output).toContain("Claude-Opus");
  });

  it("stops pagination when user declines", async () => {
    fs = createCredentialsVolume("test-key");

    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        has_more: true,
        length: 2,
        data: [
          { query_id: "entry-1", creation_time: 1705314600000000, bot_name: "Claude-Sonnet-4.5", cost_usd: "0.0015", cost_points: -50 },
          { query_id: "entry-2", creation_time: 1705310100000000, bot_name: "gpt-5.2", cost_usd: "0.0009", cost_points: -30 }
        ]
      })
    });

    confirmMock.mockResolvedValueOnce(false);

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list"]);

    expect(httpClient).toHaveBeenCalledTimes(1);
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it("loads specified number of pages without prompting when --pages is passed", async () => {
    fs = createCredentialsVolume("test-key");
    const page1Entries = [
      { query_id: "entry-1", creation_time: 1705314600000000, bot_name: "Claude-Sonnet-4.5", cost_usd: "0.0015", cost_points: -50 },
      { query_id: "entry-2", creation_time: 1705310100000000, bot_name: "gpt-5.2", cost_usd: "0.0009", cost_points: -30 }
    ];
    const page2Entries = [
      { query_id: "entry-3", creation_time: 1705240800000000, bot_name: "Claude-Opus", cost_usd: "0.003", cost_points: -100 }
    ];

    (httpClient as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ has_more: true, data: page1Entries })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ has_more: false, data: page2Entries })
      });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list", "--pages", "3"]);

    expect(confirmMock).not.toHaveBeenCalled();
    expect(httpClient).toHaveBeenCalledTimes(2);

    const output = logs.join("\n");
    expect(output).toContain("Claude-Sonnet-4.5");
    expect(output).toContain("gpt-5.2");
    expect(output).toContain("Claude-Opus");
  });

  it("stops after reaching --pages limit", async () => {
    fs = createCredentialsVolume("test-key");
    const page1Entries = [
      { query_id: "entry-1", creation_time: 1705314600000000, bot_name: "Claude-Sonnet-4.5", cost_usd: "0.0015", cost_points: -50 },
      { query_id: "entry-2", creation_time: 1705310100000000, bot_name: "gpt-5.2", cost_usd: "0.0009", cost_points: -30 }
    ];

    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ has_more: true, data: page1Entries })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list", "--pages", "1"]);

    expect(confirmMock).not.toHaveBeenCalled();
    expect(httpClient).toHaveBeenCalledTimes(1);
    const output = logs.join("\n");
    expect(output).toContain("Claude-Sonnet-4.5");
    expect(output).toContain("gpt-5.2");
  });

  it("filters results client-side when --filter provided", async () => {
    fs = createCredentialsVolume("test-key");
    const entries = [
      { query_id: "entry-1", creation_time: 1705314600000000, bot_name: "Claude-Sonnet-4.5", cost_usd: "0.0015", cost_points: -50 },
      { query_id: "entry-2", creation_time: 1705310100000000, bot_name: "gpt-5.2", cost_usd: "0.0009", cost_points: -30 },
      { query_id: "entry-3", creation_time: 1705240800000000, bot_name: "Claude-Opus", cost_usd: "0.003", cost_points: -100 }
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ has_more: false, data: entries })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list", "--filter", "claude"]);

    const output = logs.join("\n");
    expect(output).toContain("Claude-Sonnet-4.5");
    expect(output).toContain("Claude-Opus");
    expect(output).not.toContain("gpt-5.2");
    expect(logs.some((m) => m.includes('Showing entries matching "claude".'))).toBe(true);
  });

  it("filters case-insensitively on model name", async () => {
    fs = createCredentialsVolume("test-key");
    const entries = [
      { query_id: "entry-1", creation_time: 1705314600000000, bot_name: "Claude-Sonnet-4.5", cost_usd: "0.0015", cost_points: -50 },
      { query_id: "entry-2", creation_time: 1705310100000000, bot_name: "gpt-5.2", cost_usd: "0.0009", cost_points: -30 }
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ has_more: false, data: entries })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list", "--filter", "CLAUDE"]);

    const output = logs.join("\n");
    expect(output).toContain("Claude-Sonnet-4.5");
    expect(output).not.toContain("gpt-5.2");
  });

  it("shows 'No usage history found.' when API returns empty data array", async () => {
    fs = createCredentialsVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ has_more: false, data: [] })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list"]);

    expect(logs.some((m) => m.includes("No usage history found."))).toBe(true);
    expect(logs.join("\n")).not.toContain("┌");
    expect(logs.join("\n")).not.toContain("Date");
  });

  it("shows 'No entries match \"xyz\".' when filter matches nothing", async () => {
    fs = createCredentialsVolume("test-key");
    const entries = [
      { query_id: "entry-1", creation_time: 1705314600000000, bot_name: "Claude-Sonnet-4.5", cost_usd: "0.0015", cost_points: -50 },
      { query_id: "entry-2", creation_time: 1705310100000000, bot_name: "gpt-5.2", cost_usd: "0.0009", cost_points: -30 }
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ has_more: false, data: entries })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list", "--filter", "xyz"]);

    expect(logs.some((m) => m.includes('No entries match "xyz".'))).toBe(true);
    expect(logs.join("\n")).not.toContain("┌");
    expect(logs.join("\n")).not.toContain("Date");
  });

  it("pagination works with filter applied", async () => {
    fs = createCredentialsVolume("test-key");
    const page1Entries = [
      { query_id: "entry-1", creation_time: 1705314600000000, bot_name: "Claude-Sonnet-4.5", cost_usd: "0.0015", cost_points: -50 },
      { query_id: "entry-2", creation_time: 1705310100000000, bot_name: "gpt-5.2", cost_usd: "0.0009", cost_points: -30 }
    ];
    const page2Entries = [
      { query_id: "entry-3", creation_time: 1705240800000000, bot_name: "Claude-Opus", cost_usd: "0.003", cost_points: -100 },
      { query_id: "entry-4", creation_time: 1705237200000000, bot_name: "gpt-5.2", cost_usd: "0.0006", cost_points: -20 }
    ];

    (httpClient as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ has_more: true, data: page1Entries })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ has_more: false, data: page2Entries })
      });

    confirmMock.mockResolvedValueOnce(true);

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list", "--filter", "claude"]);

    const output = logs.join("\n");
    expect(output).toContain("Claude-Sonnet-4.5");
    expect(output).toContain("Claude-Opus");
    expect(output).not.toContain("gpt-5.2");
    expect(logs.some((m) => m.includes('Showing entries matching "claude".'))).toBe(true);
    expect(httpClient).toHaveBeenCalledTimes(2);
  });
});

describe("usage list table styling", () => {
  let fs: FileSystem;
  let logs: string[];
  let httpClient: HttpClient;

  beforeEach(() => {
    fs = createMemfs(homeDir);
    logs = [];
    httpClient = vi.fn();
    confirmMock.mockReset();
    isCancelMock.mockReset().mockReturnValue(false);
    getThemeMock.mockReset().mockReturnValue(createIdentityTheme());
  });

  it("styles column headers with theme.header", async () => {
    const headerFn = vi.fn((t: string) => t);
    getThemeMock.mockReturnValue({ ...createIdentityTheme(), header: headerFn });

    fs = createCredentialsVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        has_more: false,
        data: [{ query_id: "q1", creation_time: 1705314600000000, bot_name: "Claude-Sonnet-4.5", cost_usd: "0.0015", cost_points: -50 }]
      })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list"]);

    expect(headerFn).toHaveBeenCalledWith(expect.stringContaining("Date ["));
    expect(headerFn).toHaveBeenCalledWith("Model");
    expect(headerFn).toHaveBeenCalledWith("Cost");
    expect(headerFn).toHaveBeenCalledWith("Input");
    expect(headerFn).toHaveBeenCalledWith("Output");
    expect(headerFn).toHaveBeenCalledWith("Cached");
  });

  it("styles date values with theme.muted", async () => {
    const mutedFn = vi.fn((t: string) => t);
    getThemeMock.mockReturnValue({ ...createIdentityTheme(), muted: mutedFn });

    fs = createCredentialsVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        has_more: false,
        data: [{ query_id: "q1", creation_time: 1705314600000000, bot_name: "Claude-Sonnet-4.5", cost_usd: "0.0015", cost_points: -50 }]
      })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list"]);

    expect(mutedFn).toHaveBeenCalledWith(formatLocalDate(1705314600000000));
  });

  it("styles model values with theme.accent", async () => {
    const accentFn = vi.fn((t: string) => t);
    getThemeMock.mockReturnValue({ ...createIdentityTheme(), accent: accentFn });

    fs = createCredentialsVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        has_more: false,
        data: [
          { query_id: "q1", creation_time: 1705314600000000, bot_name: "Claude-Sonnet-4.5", cost_usd: "0.0015", cost_points: -50 },
          { query_id: "q2", creation_time: 1705310100000000, bot_name: "gpt-5.2", cost_usd: "0.0009", cost_points: -30 }
        ]
      })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list"]);

    expect(accentFn).toHaveBeenCalledWith("Claude-Sonnet-4.5");
    expect(accentFn).toHaveBeenCalledWith("gpt-5.2");
  });

  it("color-codes negative costs with theme.error", async () => {
    const errorFn = vi.fn((t: string) => t);
    getThemeMock.mockReturnValue({ ...createIdentityTheme(), error: errorFn });

    fs = createCredentialsVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        has_more: false,
        data: [{ query_id: "q1", creation_time: 1705314600000000, bot_name: "Claude-Sonnet-4.5", cost_usd: "0.0015", cost_points: -50 }]
      })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list"]);

    expect(errorFn).toHaveBeenCalledWith("$0.0015 (-50 points)");
  });

  it("color-codes zero and positive costs with theme.success", async () => {
    const successFn = vi.fn((t: string) => t);
    getThemeMock.mockReturnValue({ ...createIdentityTheme(), success: successFn });

    fs = createCredentialsVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        has_more: false,
        data: [
          { query_id: "q1", creation_time: 1705314600000000, bot_name: "model-a", cost_usd: "0", cost_points: 0 },
          { query_id: "q2", creation_time: 1705310100000000, bot_name: "model-b", cost_usd: "0.0003", cost_points: 10 }
        ]
      })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list"]);

    expect(successFn).toHaveBeenCalledWith("$0 (0 points)");
    expect(successFn).toHaveBeenCalledWith("$0.0003 (10 points)");
  });

  it("shows token counts from cost_breakdown_in_points with theme.muted", async () => {
    const mutedFn = vi.fn((t: string) => t);
    getThemeMock.mockReturnValue({ ...createIdentityTheme(), muted: mutedFn });

    fs = createCredentialsVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        has_more: false,
        data: [{
          query_id: "q1", creation_time: 1705314600000000, bot_name: "Claude-Sonnet-4.5",
          cost_usd: "0.0015", cost_points: -50,
          cost_breakdown_in_points: {
            Input: "10 points (500 tokens)",
            Output: "40 points (800 tokens)",
            Cached: "5 points (200 tokens)",
            Total: "50 points"
          }
        }]
      })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list"]);

    expect(mutedFn).toHaveBeenCalledWith("10 points (500 tokens)");
    expect(mutedFn).toHaveBeenCalledWith("40 points (800 tokens)");
    expect(mutedFn).toHaveBeenCalledWith("5 points (200 tokens)");
  });

  it("shows '-' for token columns when breakdown is missing", async () => {
    const mutedFn = vi.fn((t: string) => t);
    getThemeMock.mockReturnValue({ ...createIdentityTheme(), muted: mutedFn });

    fs = createCredentialsVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        has_more: false,
        data: [{
          query_id: "q1", creation_time: 1705314600000000, bot_name: "Claude-Sonnet-4.5",
          cost_usd: "0.0015", cost_points: -50
        }]
      })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list"]);

    expect(mutedFn).toHaveBeenCalledWith("-");
  });

  it("truncates long model names with '…' suffix", async () => {
    fs = createCredentialsVolume("test-key");
    const longModelName = "A".repeat(60);
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        has_more: false,
        data: [{ query_id: "q1", creation_time: 1705314600000000, bot_name: longModelName, cost_usd: "0.0015", cost_points: -50 }]
      })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list"]);

    const output = logs.join("\n");
    expect(output).not.toContain(longModelName);
    expect(output).toContain("…");
  });

  it("styles table borders with theme.muted", async () => {
    const mutedFn = vi.fn((t: string) => t);
    getThemeMock.mockReturnValue({ ...createIdentityTheme(), muted: mutedFn });

    fs = createCredentialsVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        has_more: false,
        data: [{ query_id: "q1", creation_time: 1705314600000000, bot_name: "Claude-Sonnet-4.5", cost_usd: "0.0015", cost_points: -50 }]
      })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list"]);

    expect(mutedFn).toHaveBeenCalledWith("┌");
    expect(mutedFn).toHaveBeenCalledWith("─");
    expect(mutedFn).toHaveBeenCalledWith("│");
    expect(mutedFn).toHaveBeenCalledWith("└");
  });
});
