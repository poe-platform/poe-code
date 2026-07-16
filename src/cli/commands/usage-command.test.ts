import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";
import type { FileSystem } from "../utils/file-system.js";
import type { HttpClient } from "../http.js";
import { OperationCancelledError } from "../errors.js";
import { storeTestApiKey } from "../../../tests/test-helpers.js";

const confirmMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() => vi.fn().mockReturnValue(false));
const getThemeMock = vi.hoisted(() => vi.fn());
const withSpinnerMock = vi.hoisted(() =>
  vi.fn(async <T>({ fn }: { fn: () => Promise<T> | T }) => await fn())
);
const typographyMock = vi.hoisted(() => ({
  bold: vi.fn((t: string) => t),
  dim: vi.fn((t: string) => t),
  italic: vi.fn((t: string) => t),
  underline: vi.fn((t: string) => t),
  strikethrough: vi.fn((t: string) => t)
}));

const stdinIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

function setProcessStdinIsTTY(value: boolean): () => void {
  Object.defineProperty(process.stdin, "isTTY", {
    value,
    configurable: true
  });

  return restoreProcessStdinIsTTY;
}

function restoreProcessStdinIsTTY(): void {
  if (stdinIsTTYDescriptor) {
    Object.defineProperty(process.stdin, "isTTY", stdinIsTTYDescriptor);
  } else {
    Reflect.deleteProperty(process.stdin, "isTTY");
  }
}

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

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    confirm: confirmMock,
    isCancel: isCancelMock,
    getTheme: getThemeMock,
    withSpinner: withSpinnerMock,
    typography: typographyMock
  };
});

vi.mock("poe-oauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("poe-oauth")>();
  return {
    ...actual,
    checkAuth: vi.fn(async () => ({ email: "test@example.com", balance: null }))
  };
});

const cwd = "/repo";
const homeDir = "/home/test";

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
  const fs = createFsFromVolume(volume).promises;
  return {
    ...(fs as unknown as FileSystem),
    rename: async (oldPath, newPath) => {
      await fs.rename(oldPath, newPath);
    }
  };
}

async function createConfigVolume(apiKey: string): Promise<FileSystem> {
  const fs = createMemfs(homeDir);
  await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
  await storeTestApiKey(fs, homeDir, apiKey);
  return fs;
}

function createBalanceResponse(overrides: Partial<{
  current_point_balance: number;
  plan_points_balance: number;
  addon_point_balance: number;
  plan_balance_usd: string;
  addon_balance_usd: string;
  total_balance_usd: string;
  next_daily_grant_amount: number;
  next_monthly_grant_amount: number;
  next_daily_grant_time: number;
  next_monthly_grant_time: number;
  auto_recharge: { enabled: boolean; status: string; threshold_points: number; threshold_usd: string; refill_points: number; refill_usd: string; last_recharge_failure_time: number | null };
}> = {}) {
  return {
    current_point_balance: overrides.current_point_balance ?? 1500,
    plan_points_balance: overrides.plan_points_balance ?? 0,
    addon_point_balance: overrides.addon_point_balance ?? (overrides.current_point_balance ?? 1500),
    plan_balance_usd: overrides.plan_balance_usd ?? "0.00",
    addon_balance_usd: overrides.addon_balance_usd ?? "0.05",
    total_balance_usd: overrides.total_balance_usd ?? "0.05",
    points_cycle_start_time: 1773795921000000,
    next_daily_grant_time: overrides.next_daily_grant_time ?? 0,
    next_monthly_grant_time: overrides.next_monthly_grant_time ?? 0,
    next_daily_grant_amount: overrides.next_daily_grant_amount ?? 0,
    next_monthly_grant_amount: overrides.next_monthly_grant_amount ?? 0,
    auto_recharge: overrides.auto_recharge ?? {
      enabled: false,
      status: "never_enabled",
      threshold_points: 0,
      threshold_usd: "0.00",
      refill_points: 0,
      refill_usd: "0.00",
      last_recharge_failure_time: null
    }
  };
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
    withSpinnerMock.mockClear();
  });

  it("fetches and displays current balance", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => createBalanceResponse({ current_point_balance: 1500, total_balance_usd: "0.05" })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
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
    expect(withSpinnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Fetching usage balance...",
        stopMessage: expect.any(Function)
      })
    );
    const balanceSpinnerOptions = withSpinnerMock.mock.calls[0]?.[0] as
      | { stopMessage?: () => string }
      | undefined;
    expect(balanceSpinnerOptions?.stopMessage?.()).toBe("Usage balance fetched");
    expect(
      logs.some((message) => message.includes("Balance:") && message.includes("1,500 pts"))
    ).toBe(true);
    expect(
      logs.some((message) => message.includes("https://poe.com/api/keys"))
    ).toBe(true);
  });

  it("shows balance when invoked without subcommand", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => createBalanceResponse()
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
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
      logs.some((message) => message.includes("Balance:") && message.includes("1,500 pts"))
    ).toBe(true);
  });

  it("prompts for API key when not stored and uses it", async () => {
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => createBalanceResponse({ current_point_balance: 500 })
    });

    // "prompted-key" fails API key format validation (too short).
    // Accept the non-standard format so resolveApiKey doesn't loop forever.
    confirmMock.mockResolvedValueOnce(true);

    // Prompting for a key only happens for a human at a terminal.
    const restoreStdin = setProcessStdinIsTTY(true);

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({ apiKey: "prompted-key" }),
      env: { cwd, homeDir, variables: { POE_CODE_OAUTH_LOGIN: "0" } },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    try {
      await program.parseAsync(["node", "cli", "usage", "balance"]);
    } finally {
      restoreStdin();
    }

    expect(httpClient).toHaveBeenCalledWith(
      expect.stringContaining("/usage/current_balance"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer prompted-key"
        })
      })
    );
  });

  it("uses POE_API_KEY for balance without interactive authentication", async () => {
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => createBalanceResponse({ current_point_balance: 1500 })
    });
    const prompts = vi.fn();
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir, variables: { POE_API_KEY: "environment-balance-key", POE_CODE_OAUTH_LOGIN: "0" } },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "balance"]);

    expect(httpClient).toHaveBeenCalledWith(
      expect.stringContaining("/usage/current_balance"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer environment-balance-key" }) })
    );
    expect(prompts).not.toHaveBeenCalled();
  });

  it("logs dry run message when --dry-run flag is set", async () => {
    fs = await createConfigVolume("test-key");

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
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

  it("rejects dry-run balance when no API key is available", async () => {
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: { POE_CODE_OAUTH_LOGIN: "0" } },
      httpClient,
      logger: (message) => logs.push(message),
      exitOverride: true
    });

    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: true } as any);

    await expect(program.parseAsync(["node", "cli", "--dry-run", "usage"])).rejects.toThrow(
      "No API key found. Pass --api-key, set POE_API_KEY, or run without --yes to authenticate interactively."
    );

    expect(httpClient).not.toHaveBeenCalled();
    expect(logs.some((message) => message.includes("Dry run"))).toBe(false);
  });

  it("does not migrate legacy credentials while previewing balance", async () => {
    await storeTestApiKey(fs, homeDir, "legacy-key");
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
      httpClient,
      logger: (message) => logs.push(message),
      exitOverride: true
    });

    await program.parseAsync(["node", "cli", "--dry-run", "usage"]);

    await expect(fs.readdir(`${homeDir}/.poe-code`)).resolves.toEqual(["credentials.enc"]);
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
    withSpinnerMock.mockClear();
    typographyMock.bold.mockReset().mockImplementation((t: string) => t);
  });

  it("styles total balance with theme.accent", async () => {
    const accentFn = vi.fn((t: string) => t);
    getThemeMock.mockReturnValue({ ...createIdentityTheme(), accent: accentFn });

    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => createBalanceResponse({ current_point_balance: 1500, total_balance_usd: "0.05" })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "balance"]);

    expect(accentFn).toHaveBeenCalledWith("$0.05 (1,500 pts)");
  });

  it("applies bold to the total balance value", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => createBalanceResponse({ current_point_balance: 2500, total_balance_usd: "0.08" })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "balance"]);

    expect(typographyMock.bold).toHaveBeenCalledWith("$0.08 (2,500 pts)");
  });

  it("shows plan and addon breakdown under balance", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => createBalanceResponse({
        current_point_balance: 750,
        plan_points_balance: 250,
        addon_point_balance: 500,
        plan_balance_usd: "0.01",
        addon_balance_usd: "0.02",
        total_balance_usd: "0.03"
      })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "balance"]);

    const output = logs.join("\n");
    expect(output).toContain("Balance:");
    expect(output).toContain("750 pts");
    expect(output).toContain("Plan:");
    expect(output).toContain("$0.01 (250 pts)");
    expect(output).toContain("Add-on:");
    expect(output).toContain("$0.02 (500 pts)");
  });

  it("shows next monthly grant when nonzero", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => createBalanceResponse({
        next_monthly_grant_amount: 12600000,
        next_monthly_grant_time: 1776425721000000
      })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "balance"]);

    const output = logs.join("\n");
    expect(output).toContain("Next monthly grant:");
    expect(output).toContain("12,600,000 pts");
  });

  it("hides grant lines when amounts are zero", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => createBalanceResponse({
        next_daily_grant_amount: 0,
        next_monthly_grant_amount: 0
      })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "balance"]);

    const output = logs.join("\n");
    expect(output).not.toContain("Next daily grant:");
    expect(output).not.toContain("Next monthly grant:");
  });

  it("shows (auto) label on Add-on when auto-recharge is enabled", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => createBalanceResponse({
        auto_recharge: {
          enabled: true,
          status: "active",
          threshold_points: 1000,
          threshold_usd: "0.03",
          refill_points: 5000,
          refill_usd: "0.15",
          last_recharge_failure_time: null
        }
      })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "balance"]);

    const output = logs.join("\n");
    expect(output).toContain("Add-on (auto):");
  });
});

describe("usage list command", () => {
  let fs: FileSystem;
  let logs: string[];
  let httpClient: HttpClient;

  beforeEach(() => {
    setProcessStdinIsTTY(true);
    fs = createMemfs(homeDir);
    logs = [];
    httpClient = vi.fn();
    confirmMock.mockReset();
    isCancelMock.mockReset().mockReturnValue(false);
    getThemeMock.mockReset().mockReturnValue(createIdentityTheme());
    withSpinnerMock.mockClear();
  });

  afterEach(() => {
    restoreProcessStdinIsTTY();
  });

  it("fetches and displays usage history from GET /usage/points_history with limit=20", async () => {
    fs = await createConfigVolume("test-key");
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
          "Cache discount": "-2 points (100 tokens)",
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
      env: { cwd, homeDir, variables: {} },
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
    expect(tableOutput).toContain("500");
    expect(tableOutput).toContain("800");
    expect(tableOutput).toContain("300");
    expect(tableOutput).toContain("400");
    expect(tableOutput).toContain("100");
  });

  it("uses POE_API_KEY for usage history without interactive authentication", async () => {
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ has_more: false, data: [] })
    });
    const prompts = vi.fn();
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir, variables: { POE_API_KEY: "environment-list-key", POE_CODE_OAUTH_LOGIN: "0" } },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list"]);

    expect(httpClient).toHaveBeenCalledWith(
      expect.stringContaining("/usage/points_history?limit=20"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer environment-list-key" }) })
    );
    expect(prompts).not.toHaveBeenCalled();
  });

  it("does not migrate legacy credentials while previewing usage history", async () => {
    await storeTestApiKey(fs, homeDir, "legacy-key");
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
      httpClient,
      logger: (message) => logs.push(message),
      exitOverride: true
    });

    await program.parseAsync(["node", "cli", "--dry-run", "usage", "list", "--pages", "1"]);

    await expect(fs.readdir(`${homeDir}/.poe-code`)).resolves.toEqual(["credentials.enc"]);
  });

  it("rejects dry-run usage history when no API key is available", async () => {
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: { POE_CODE_OAUTH_LOGIN: "0" } },
      httpClient,
      logger: (message) => logs.push(message),
      exitOverride: true
    });

    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: true } as any);

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "usage", "list", "--pages", "1"])
    ).rejects.toThrow(
      "No API key found. Pass --api-key, set POE_API_KEY, or run without --yes to authenticate interactively."
    );

    expect(httpClient).not.toHaveBeenCalled();
    expect(logs.some((message) => message.includes("Dry run"))).toBe(false);
  });

  it("prompts 'Load more?' when API returns has_more=true", async () => {
    fs = await createConfigVolume("test-key");
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
      env: { cwd, homeDir, variables: {} },
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

  it("stops after the first page without prompting in non-interactive mode", async () => {
    const restoreStdin = setProcessStdinIsTTY(false);
    fs = await createConfigVolume("test-key");
    const page1Entries = [
      { query_id: "entry-1", creation_time: 1705314600000000, bot_name: "Claude-Sonnet-4.5", cost_usd: "0.0015", cost_points: -50 }
    ];

    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ has_more: true, data: page1Entries })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    try {
      await program.parseAsync(["node", "cli", "usage", "list"]);
    } finally {
      restoreStdin();
    }

    expect(confirmMock).not.toHaveBeenCalled();
    expect(httpClient).toHaveBeenCalledTimes(1);
    expect(logs.join("\n")).toContain("Claude-Sonnet-4.5");
  });

  it("loads all available usage pages without prompting when --yes is set", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          has_more: true,
          data: [{ query_id: "entry-1", creation_time: 0, bot_name: "one", cost_usd: "0", cost_points: 0 }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          has_more: false,
          data: [{ query_id: "entry-2", creation_time: 0, bot_name: "two", cost_usd: "0", cost_points: 0 }]
        })
      });
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "--yes", "usage", "list"]);

    expect(confirmMock).not.toHaveBeenCalled();
    expect(httpClient).toHaveBeenCalledTimes(2);
  });

  it("stops pagination when user declines", async () => {
    fs = await createConfigVolume("test-key");

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
      env: { cwd, homeDir, variables: {} },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list"]);

    expect(httpClient).toHaveBeenCalledTimes(1);
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it("aborts pagination when user cancels confirmation", async () => {
    fs = await createConfigVolume("test-key");

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

    confirmMock.mockResolvedValueOnce(Symbol("cancelled"));
    isCancelMock.mockReturnValue(true);

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await expect(
      program.parseAsync(["node", "cli", "usage", "list"])
    ).rejects.toBeInstanceOf(OperationCancelledError);

    expect(httpClient).toHaveBeenCalledTimes(1);
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it("loads specified number of pages without prompting when --pages is passed", async () => {
    fs = await createConfigVolume("test-key");
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
      env: { cwd, homeDir, variables: {} },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list", "--pages", "3"]);

    expect(confirmMock).not.toHaveBeenCalled();
    expect(httpClient).toHaveBeenCalledTimes(2);
    expect(withSpinnerMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: "Fetching usage history page 1..."
      })
    );
    expect(withSpinnerMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: "Fetching usage history page 2..."
      })
    );

    const output = logs.join("\n");
    expect(output).toContain("Claude-Sonnet-4.5");
    expect(output).toContain("gpt-5.2");
    expect(output).toContain("Claude-Opus");
  });

  it.each(["abc", "0", "-1", "1abc", "1.5"])(
    "rejects invalid --pages value %s before fetching usage",
    async (value) => {
      const program = createProgram({
        fs,
        prompts: vi.fn(),
        env: { cwd, homeDir, variables: {} },
        httpClient,
        logger: (message) => logs.push(message)
      });

      const optsSpy = vi.spyOn(program, "optsWithGlobals");
      optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

      await expect(
        program.parseAsync(["node", "cli", "usage", "list", "--pages", value])
      ).rejects.toThrow("Expected a positive integer.");

      expect(httpClient).not.toHaveBeenCalled();
      expect(confirmMock).not.toHaveBeenCalled();
    }
  );

  it("stops after reaching --pages limit", async () => {
    fs = await createConfigVolume("test-key");
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
      env: { cwd, homeDir, variables: {} },
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

  it("URL-encodes opaque pagination cursors", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          has_more: true,
          data: [
            {
              query_id: "entry&cursor=broken",
              creation_time: 1705314600000000,
              bot_name: "Claude-Sonnet-4.5",
              cost_usd: "0.0015",
              cost_points: -50
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ has_more: false, data: [] })
      });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list", "--pages", "2"]);

    const secondUrl = String((httpClient as ReturnType<typeof vi.fn>).mock.calls[1][0]);
    expect(secondUrl).toContain("starting_after=entry%26cursor%3Dbroken");
    expect(secondUrl).not.toContain("starting_after=entry&cursor=broken");
  });

  it("filters results client-side when --filter provided", async () => {
    fs = await createConfigVolume("test-key");
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
      env: { cwd, homeDir, variables: {} },
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

  it("trims --filter before matching usage history", async () => {
    fs = await createConfigVolume("test-key");
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
      env: { cwd, homeDir, variables: {} },
      httpClient,
      logger: (message) => logs.push(message)
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list", "--filter", " Claude "]);

    const output = logs.join("\n");
    expect(output).toContain("Claude-Sonnet-4.5");
    expect(output).not.toContain("gpt-5.2");
    expect(logs.some((m) => m.includes('Showing entries matching "Claude".'))).toBe(true);
  });

  it("filters case-insensitively on model name", async () => {
    fs = await createConfigVolume("test-key");
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
      env: { cwd, homeDir, variables: {} },
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
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ has_more: false, data: [] })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
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
    fs = await createConfigVolume("test-key");
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
      env: { cwd, homeDir, variables: {} },
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
    fs = await createConfigVolume("test-key");
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
      env: { cwd, homeDir, variables: {} },
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
    setProcessStdinIsTTY(true);
    fs = createMemfs(homeDir);
    logs = [];
    httpClient = vi.fn();
    confirmMock.mockReset();
    isCancelMock.mockReset().mockReturnValue(false);
    getThemeMock.mockReset().mockReturnValue(createIdentityTheme());
    withSpinnerMock.mockClear();
  });

  afterEach(() => {
    restoreProcessStdinIsTTY();
  });

  it("styles column headers with theme.header", async () => {
    const headerFn = vi.fn((t: string) => t);
    getThemeMock.mockReturnValue({ ...createIdentityTheme(), header: headerFn });

    fs = await createConfigVolume("test-key");
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
      env: { cwd, homeDir, variables: {} },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list"]);

    expect(headerFn).toHaveBeenCalledWith(expect.stringContaining("Date ["));
    expect(headerFn).toHaveBeenCalledWith("Model");
    expect(headerFn).toHaveBeenCalledWith("Cost");
    expect(headerFn).toHaveBeenCalledWith("Input tkn");
    expect(headerFn).toHaveBeenCalledWith("Output tkn");
    expect(headerFn).toHaveBeenCalledWith("Cached tkn");
  });

  it("styles date values with theme.muted", async () => {
    const mutedFn = vi.fn((t: string) => t);
    getThemeMock.mockReturnValue({ ...createIdentityTheme(), muted: mutedFn });

    fs = await createConfigVolume("test-key");
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
      env: { cwd, homeDir, variables: {} },
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

    fs = await createConfigVolume("test-key");
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
      env: { cwd, homeDir, variables: {} },
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

    fs = await createConfigVolume("test-key");
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
      env: { cwd, homeDir, variables: {} },
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

    fs = await createConfigVolume("test-key");
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
      env: { cwd, homeDir, variables: {} },
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

    fs = await createConfigVolume("test-key");
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
            "Cache discount": "-5 points (200 tokens)",
            Total: "50 points"
          }
        }]
      })
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list"]);

    expect(mutedFn).toHaveBeenCalledWith("500");
    expect(mutedFn).toHaveBeenCalledWith("800");
    expect(mutedFn).toHaveBeenCalledWith("200");
  });

  it("shows '-' for token columns when breakdown is missing", async () => {
    const mutedFn = vi.fn((t: string) => t);
    getThemeMock.mockReturnValue({ ...createIdentityTheme(), muted: mutedFn });

    fs = await createConfigVolume("test-key");
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
      env: { cwd, homeDir, variables: {} },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "usage", "list"]);

    expect(mutedFn).toHaveBeenCalledWith("-");
  });

  it("truncates long model names with '…' suffix", async () => {
    fs = await createConfigVolume("test-key");
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
      env: { cwd, homeDir, variables: {} },
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

    fs = await createConfigVolume("test-key");
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
      env: { cwd, homeDir, variables: {} },
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
