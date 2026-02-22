import { describe, it, expect, beforeEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";
import type { FileSystem } from "../utils/file-system.js";
import type { CommandRunner } from "../../utils/command-checks.js";
import { DEFAULT_CLAUDE_CODE_MODEL, stripModelNamespace } from "../constants.js";
import { OperationCancelledError } from "../errors.js";

const confirmMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() => vi.fn().mockReturnValue(false));
const VALID_API_KEY = "vnlaoHCddCx7eAGLgdH4iS-g_1MYPsg0JnTRPF1qMuo";
const SECOND_VALID_API_KEY = "znlaoHCddCx7eAGLgdH4iS-g_1MYPsg0JnTRPF1qMuo";
const TOO_SHORT_SK_POE_API_KEY = "sk-poe-abc123";

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
  return {
    ...actual,
    confirm: confirmMock,
    isCancel: isCancelMock,
    confirmOrCancel: async (options: { message: string }) => {
      const result = await confirmMock(options);
      if (isCancelMock(result)) {
        throw new actual.PromptCancelledError();
      }
      return result === true;
    }
  };
});

function createMemfs(homeDir: string): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

describe("login command", () => {
  const cwd = "/repo";
  const homeDir = "/home/test";
  const credentialsPath = `${homeDir}/.poe-code/credentials.json`;
  let fs: FileSystem;
  let logs: string[];
  let prompts: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fs = createMemfs(homeDir);
    logs = [];
    prompts = vi.fn();
    confirmMock.mockReset();
    isCancelMock.mockReset().mockReturnValue(false);
  });

  it("stores the provided api key flag", async () => {
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync([
      "node",
      "cli",
      "login",
      "--api-key",
      VALID_API_KEY
    ]);

    const raw = await fs.readFile(credentialsPath, "utf8");
    expect(JSON.parse(raw)).toEqual(
      expect.objectContaining({ apiKey: VALID_API_KEY })
    );
    expect(prompts).not.toHaveBeenCalled();
    expect(
      logs.some((message) => message.includes("Logged in."))
    ).toBe(true);

    await expect(fs.stat(`${homeDir}/.claude/settings.json`)).rejects.toBeTruthy();
    await expect(fs.stat(`${homeDir}/.codex/config.toml`)).rejects.toBeTruthy();
    await expect(
      fs.stat(`${homeDir}/.config/opencode/config.json`)
    ).rejects.toBeTruthy();
  });

  it("reads API key from POE_API_KEY env variable when flag not provided", async () => {
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir, variables: { POE_API_KEY: VALID_API_KEY } },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login"]);

    const raw = await fs.readFile(credentialsPath, "utf8");
    expect(JSON.parse(raw)).toEqual(
      expect.objectContaining({ apiKey: VALID_API_KEY })
    );
    expect(prompts).not.toHaveBeenCalled();
  });

  it("prefers --api-key flag over POE_API_KEY env variable", async () => {
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir, variables: { POE_API_KEY: VALID_API_KEY } },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync([
      "node",
      "cli",
      "login",
      "--api-key",
      SECOND_VALID_API_KEY
    ]);

    const raw = await fs.readFile(credentialsPath, "utf8");
    expect(JSON.parse(raw)).toEqual(
      expect.objectContaining({ apiKey: SECOND_VALID_API_KEY })
    );
    expect(prompts).not.toHaveBeenCalled();
  });

  it("prompts for an api key when flag missing", async () => {
    prompts.mockResolvedValue({ apiKey: VALID_API_KEY });
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login"]);

    const stored = await fs.readFile(credentialsPath, "utf8");
    expect(JSON.parse(stored)).toEqual(
      expect.objectContaining({ apiKey: VALID_API_KEY })
    );
    expect(prompts).toHaveBeenCalledTimes(1);
    const [descriptor] = prompts.mock.calls[0]!;
    expect(descriptor.message).toContain("Poe API key");
  });

  it("re-prompts when prompted key format is rejected", async () => {
    prompts
      .mockResolvedValueOnce({ apiKey: "bad key!" })
      .mockResolvedValueOnce({ apiKey: VALID_API_KEY });
    confirmMock.mockResolvedValue(false);

    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login"]);

    expect(prompts).toHaveBeenCalledTimes(2);
    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("format")
      })
    );

    const raw = await fs.readFile(credentialsPath, "utf8");
    expect(JSON.parse(raw)).toEqual(
      expect.objectContaining({ apiKey: VALID_API_KEY })
    );
  });

  it("re-prompts when prompted key is missing", async () => {
    prompts
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ apiKey: VALID_API_KEY });

    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login"]);

    expect(prompts).toHaveBeenCalledTimes(2);
    expect(confirmMock).not.toHaveBeenCalled();

    const raw = await fs.readFile(credentialsPath, "utf8");
    expect(JSON.parse(raw)).toEqual(
      expect.objectContaining({ apiKey: VALID_API_KEY })
    );
  });

  it("re-prompts when prompted key is empty", async () => {
    prompts
      .mockResolvedValueOnce({ apiKey: "" })
      .mockResolvedValueOnce({ apiKey: VALID_API_KEY });

    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login"]);

    expect(prompts).toHaveBeenCalledTimes(2);
    expect(confirmMock).not.toHaveBeenCalled();

    const raw = await fs.readFile(credentialsPath, "utf8");
    expect(JSON.parse(raw)).toEqual(
      expect.objectContaining({ apiKey: VALID_API_KEY })
    );
  });

  it("prompts for a new api key even when stored credentials already exist", async () => {
    const volume = new Volume();
    volume.mkdirSync(homeDir, { recursive: true });
    volume.mkdirSync(`${homeDir}/.poe-code`, { recursive: true });
    volume.writeFileSync(
      credentialsPath,
      JSON.stringify({ apiKey: "old-key" })
    );
    fs = createFsFromVolume(volume).promises as unknown as FileSystem;

    prompts.mockResolvedValue({ apiKey: SECOND_VALID_API_KEY });
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login"]);

    expect(prompts).toHaveBeenCalledTimes(1);
    const raw = await fs.readFile(credentialsPath, "utf8");
    expect(JSON.parse(raw)).toEqual(
      expect.objectContaining({ apiKey: SECOND_VALID_API_KEY })
    );
  });

  it("reconfigures all previously configured services with new api key", async () => {
    const volume = new Volume();
    volume.mkdirSync(homeDir, { recursive: true });
    volume.mkdirSync(`${homeDir}/.claude`, { recursive: true });
    volume.mkdirSync(`${homeDir}/.poe-code`, { recursive: true });

    volume.writeFileSync(
      `${homeDir}/.claude/settings.json`,
      JSON.stringify({ apiKeyHelper: "echo old-key", model: "claude-sonnet-4.6" })
    );
    volume.writeFileSync(
      credentialsPath,
      JSON.stringify({
        apiKey: "old-key",
        configured_services: {
          "claude-code": { files: [`${homeDir}/.claude/settings.json`] }
        }
      })
    );

    fs = createFsFromVolume(volume).promises as unknown as FileSystem;

    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync([
      "node",
      "cli",
      "login",
      "--api-key",
      SECOND_VALID_API_KEY
    ]);

    const settingsRaw = await fs.readFile(
      `${homeDir}/.claude/settings.json`,
      "utf8"
    );
    const settings = JSON.parse(settingsRaw);
    expect(settings.apiKeyHelper).toBe(`echo ${SECOND_VALID_API_KEY}`);
    expect(settings.model).toBe(stripModelNamespace(DEFAULT_CLAUDE_CODE_MODEL));
  });

  it("skips writing credentials during dry run", async () => {
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      },
      exitOverride: true
    });

    prompts.mockResolvedValue({ apiKey: VALID_API_KEY });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: true } as any);

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "login",
      "--api-key",
      VALID_API_KEY
    ]);

    await expect(fs.readFile(credentialsPath, "utf8")).rejects.toThrow();
    expect(
      logs.some((message) =>
        message.includes("Dry run: would save API key.")
      )
    ).toBe(true);
  });

  it("confirms env var usage when --yes is not set", async () => {
    confirmMock.mockResolvedValue(true);
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir, variables: { POE_API_KEY: VALID_API_KEY } },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login"]);

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("environment")
      })
    );
    const raw = await fs.readFile(credentialsPath, "utf8");
    expect(JSON.parse(raw)).toEqual(
      expect.objectContaining({ apiKey: VALID_API_KEY })
    );
  });

  it("falls through to prompt when user declines env var", async () => {
    confirmMock.mockResolvedValue(false);
    prompts.mockResolvedValue({ apiKey: VALID_API_KEY });
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir, variables: { POE_API_KEY: VALID_API_KEY } },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login"]);

    const raw = await fs.readFile(credentialsPath, "utf8");
    expect(JSON.parse(raw)).toEqual(
      expect.objectContaining({ apiKey: VALID_API_KEY })
    );
  });

  it("cancels login when env var confirmation is cancelled", async () => {
    const cancelled = Symbol("cancelled");
    confirmMock.mockResolvedValue(cancelled);
    isCancelMock.mockReturnValue(true);

    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir, variables: { POE_API_KEY: VALID_API_KEY } },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await expect(
      program.parseAsync(["node", "cli", "login"])
    ).rejects.toBeInstanceOf(OperationCancelledError);
    await expect(fs.readFile(credentialsPath, "utf8")).rejects.toThrow();
    expect(
      logs.some((message) => message.includes("Error during login command"))
    ).toBe(false);
  });

  it("confirms invalid format key when --yes is not set", async () => {
    confirmMock.mockResolvedValue(true);
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: false } as any);

    await program.parseAsync([
      "node",
      "cli",
      "login",
      "--api-key",
      "has spaces"
    ]);

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("format")
      })
    );
    const raw = await fs.readFile(credentialsPath, "utf8");
    expect(JSON.parse(raw)).toEqual(
      expect.objectContaining({ apiKey: "has spaces" })
    );
  });

  it("rejects short api key without prompting when --yes is set", async () => {
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "login",
        "--api-key",
        TOO_SHORT_SK_POE_API_KEY
      ])
    ).rejects.toThrow("API key rejected.");

    expect(confirmMock).not.toHaveBeenCalled();
    await expect(fs.readFile(credentialsPath, "utf8")).rejects.toThrow();
  });

  it("rejects invalid env api key without prompting when --yes is set", async () => {
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir, variables: { POE_API_KEY: TOO_SHORT_SK_POE_API_KEY } },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await expect(
      program.parseAsync(["node", "cli", "login"])
    ).rejects.toThrow("API key rejected.");

    expect(prompts).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    await expect(fs.readFile(credentialsPath, "utf8")).rejects.toThrow();
  });
});
