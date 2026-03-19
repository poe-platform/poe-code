import { describe, it, expect, beforeEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";
import type { FileSystem } from "../utils/file-system.js";
import type { CommandRunner } from "../../utils/command-checks.js";
import { DEFAULT_CLAUDE_CODE_MODEL, stripModelNamespace } from "../constants.js";
import { createAuthStore } from "@poe-code/auth";

vi.mock("../oauth-login.js", () => ({
  resolveApiKeyViaOAuth: vi.fn(async () => "sk-poe-OAuthKeyFromBrowserFlowTestValue1234567890abc")
}));

// Valid-format API keys for tests (43+ alphanumeric characters)
const TEST_KEY = "sk-poe-TestKeyValue1234567890abcdefghijklmnop";
const ENV_KEY = "sk-poe-EnvKeyValue01234567890abcdefghijklmnop";
const FLAG_KEY = "sk-poe-FlagKeyValue1234567890abcdefghijklmnop";
const PROMPT_KEY = "sk-poe-PromptKeyVal1234567890abcdefghijklmnop";
const NEW_KEY = "sk-poe-NewKeyValue01234567890abcdefghijklmnop";
const MANUAL_KEY = "sk-poe-ManualKeyVal1234567890abcdefghijklmnop";
const DRY_KEY = "sk-poe-DryRunKeyVal1234567890abcdefghijklmnop";
const OAUTH_KEY = "sk-poe-OAuthKeyFromBrowserFlowTestValue1234567890abc";

function createMemfs(homeDir: string): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function readStoredApiKey(fs: FileSystem, homeDir: string): Promise<string | null> {
  const authFs = {
    readFile: (filePath: string, encoding: BufferEncoding) => fs.readFile(filePath, encoding),
    writeFile: (filePath: string, data: string | NodeJS.ArrayBufferView, opts?: { encoding?: BufferEncoding }) =>
      fs.writeFile(filePath, data, opts),
    mkdir: (directoryPath: string, opts?: { recursive?: boolean }) =>
      fs.mkdir(directoryPath, opts).then(() => undefined),
    unlink: (filePath: string) => fs.unlink(filePath),
    chmod: (filePath: string, mode: number) =>
      fs.chmod ? fs.chmod(filePath, mode) : Promise.resolve()
  };
  const { store } = createAuthStore({
    fileStore: { fs: authFs, getHomeDirectory: () => homeDir }
  });
  return store.getApiKey();
}

describe("login command", () => {
  const cwd = "/repo";
  const homeDir = "/home/test";
  const configPath = `${homeDir}/.poe-code/config.json`;
  let fs: FileSystem;
  let logs: string[];
  let prompts: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fs = createMemfs(homeDir);
    logs = [];
    prompts = vi.fn();
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
      TEST_KEY
    ]);

    const storedKey = await readStoredApiKey(fs, homeDir);
    expect(storedKey).toBe(TEST_KEY);
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
      env: { cwd, homeDir, variables: { POE_API_KEY: ENV_KEY } },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login"]);

    const storedKey = await readStoredApiKey(fs, homeDir);
    expect(storedKey).toBe(ENV_KEY);
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
      env: { cwd, homeDir, variables: { POE_API_KEY: ENV_KEY } },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login", "--api-key", FLAG_KEY]);

    const storedKey = await readStoredApiKey(fs, homeDir);
    expect(storedKey).toBe(FLAG_KEY);
    expect(prompts).not.toHaveBeenCalled();
  });

  it("prompts for an api key when flag missing and OAuth disabled", async () => {
    prompts.mockResolvedValue({ apiKey: PROMPT_KEY });
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir, variables: { POE_CODE_OAUTH_LOGIN: "0" } },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login"]);

    const storedKey = await readStoredApiKey(fs, homeDir);
    expect(storedKey).toBe(PROMPT_KEY);
    expect(prompts).toHaveBeenCalledTimes(1);
    const [descriptor] = prompts.mock.calls[0]!;
    expect(descriptor.message).toContain("Poe API key");
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
      configPath,
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
      NEW_KEY
    ]);

    const settingsRaw = await fs.readFile(
      `${homeDir}/.claude/settings.json`,
      "utf8"
    );
    const settings = JSON.parse(settingsRaw);
    expect(settings.apiKeyHelper).toBe(`echo ${NEW_KEY}`);
    expect(settings.model).toBe(stripModelNamespace(DEFAULT_CLAUDE_CODE_MODEL));
  });

  it("uses OAuth flow by default", async () => {
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir, variables: {} },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login"]);

    const storedKey = await readStoredApiKey(fs, homeDir);
    expect(storedKey).toBe(OAUTH_KEY);
    expect(prompts).not.toHaveBeenCalled();
    expect(
      logs.some((message) => message.includes("Logged in."))
    ).toBe(true);
  });

  it("prefers --api-key flag over OAuth flow", async () => {
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir, variables: {} },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login", "--api-key", MANUAL_KEY]);

    const storedKey = await readStoredApiKey(fs, homeDir);
    expect(storedKey).toBe(MANUAL_KEY);
  });

  it("skips writing config during dry run", async () => {
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

    prompts.mockResolvedValue({ apiKey: DRY_KEY });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: true } as any);

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "login",
      "--api-key",
      DRY_KEY
    ]);

    const storedKey = await readStoredApiKey(fs, homeDir);
    expect(storedKey).toBeNull();
    expect(
      logs.some((message) =>
        message.includes("Dry run: would save API key.")
      )
    ).toBe(true);
  });
});
