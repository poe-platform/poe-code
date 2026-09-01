import { beforeEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { resolveConfigPath } from "@poe-code/poe-code-config/core";
import { createProgram } from "../program.js";
import type { FileSystem } from "../utils/file-system.js";

const braintrustMock = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  shutdown: vi.fn()
}));

vi.mock("@poe-code/braintrust", () => ({
  bootstrap: braintrustMock.bootstrap
}));

const cwd = "/repo";
const homeDir = "/home/test";
const configPath = resolveConfigPath(homeDir);

function createMemFs(): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(`${homeDir}/.poe-code`, { recursive: true });
  volume.mkdirSync(`${cwd}/.poe-code`, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

async function writeConfig(fs: FileSystem, document: unknown): Promise<void> {
  await fs.writeFile(configPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

async function runBraintrust(
  fs: FileSystem,
  args: string[],
  flags: { dryRun?: boolean } = {}
): Promise<string[]> {
  const logs: string[] = [];
  const program = createProgram({
    fs,
    prompts: vi.fn(),
    env: { cwd, homeDir },
    logger: (message) => logs.push(message)
  });
  vi.spyOn(program, "optsWithGlobals").mockReturnValue({
    yes: false,
    dryRun: flags.dryRun ?? false
  } as any);

  await program.parseAsync(["node", "cli", "braintrust", ...args]);
  return logs;
}

async function runBraintrustStatus(fs: FileSystem): Promise<string[]> {
  return runBraintrust(fs, ["status"]);
}

async function readConfig(fs: FileSystem): Promise<any> {
  return JSON.parse(await fs.readFile(configPath, "utf8"));
}

describe("braintrust command", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createMemFs();
    braintrustMock.bootstrap.mockReset();
    braintrustMock.shutdown.mockReset();
  });

  it("prints disabled when Braintrust config is absent", async () => {
    const logs = await runBraintrustStatus(fs);

    expect(logs).toContain("disabled");
    expect(braintrustMock.bootstrap).not.toHaveBeenCalled();
  });

  it("prints disabled when Braintrust config is disabled", async () => {
    await writeConfig(fs, {
      integrations: {
        braintrust: {
          enabled: false
        }
      }
    });

    const logs = await runBraintrustStatus(fs);

    expect(logs).toContain("disabled");
    expect(braintrustMock.bootstrap).not.toHaveBeenCalled();
  });

  it("prints one line per missing required field without bootstrapping", async () => {
    await writeConfig(fs, {
      integrations: {
        braintrust: {
          enabled: true
        }
      }
    });

    const logs = await runBraintrustStatus(fs);

    expect(logs).toContain("missing apiKey");
    expect(logs).toContain("missing project");
    expect(braintrustMock.bootstrap).not.toHaveBeenCalled();
  });

  it("bootstraps configured Braintrust and shuts it down before exit", async () => {
    await writeConfig(fs, {
      integrations: {
        braintrust: {
          enabled: true,
          apiKey: "key",
          project: "poe-code"
        }
      }
    });
    braintrustMock.bootstrap.mockReturnValue({
      status: () => ({
        project: "poe-code",
        lastError: "flush failed",
        errorCount: 2
      }),
      shutdown: braintrustMock.shutdown
    });

    const logs = await runBraintrustStatus(fs);

    expect(braintrustMock.bootstrap).toHaveBeenCalledWith({
      enabled: true,
      apiKey: "key",
      project: "poe-code"
    });
    expect(logs).toContain("enabled, project=poe-code, last error: flush failed, errors: 2");
    expect(braintrustMock.shutdown).toHaveBeenCalledOnce();
  });

  it("prints none for an enabled configured integration with no last error", async () => {
    await writeConfig(fs, {
      integrations: {
        braintrust: {
          enabled: true,
          apiKey: "key",
          project: "poe-code"
        }
      }
    });
    braintrustMock.bootstrap.mockReturnValue({
      status: () => ({
        project: "poe-code",
        lastError: null,
        errorCount: 0
      }),
      shutdown: braintrustMock.shutdown
    });

    const logs = await runBraintrustStatus(fs);

    expect(logs).toContain("enabled, project=poe-code, last error: none, errors: 0");
    expect(braintrustMock.shutdown).toHaveBeenCalledOnce();
  });

  it("points at the enable command when status is disabled", async () => {
    const logs = await runBraintrustStatus(fs);

    expect(logs.join("\n")).toContain('Run "poe-code braintrust enable"');
  });

  it("enables the integration and keeps the existing credentials", async () => {
    await writeConfig(fs, {
      integrations: {
        braintrust: {
          enabled: false,
          apiKey: "${BRAINTRUST_API_KEY}",
          project: "poe-code"
        }
      }
    });

    const logs = await runBraintrust(fs, ["enable"]);

    expect((await readConfig(fs)).integrations.braintrust).toEqual({
      enabled: true,
      apiKey: "${BRAINTRUST_API_KEY}",
      project: "poe-code"
    });
    expect(logs.join("\n")).toContain("enabled");
  });

  it("names the missing required fields as next steps after enabling", async () => {
    const logs = await runBraintrust(fs, ["enable"]);

    expect((await readConfig(fs)).integrations.braintrust).toEqual({ enabled: true });
    expect(logs.join("\n")).toContain("integrations.braintrust.apiKey");
    expect(logs.join("\n")).toContain("integrations.braintrust.project");
  });

  it("preserves other config scopes when disabling", async () => {
    await writeConfig(fs, {
      core: { defaultAgent: "claude-code" },
      integrations: {
        braintrust: {
          enabled: true,
          apiKey: "key",
          project: "poe-code"
        }
      }
    });

    await runBraintrust(fs, ["disable"]);

    const document = await readConfig(fs);
    expect(document.integrations.braintrust).toEqual({
      enabled: false,
      apiKey: "key",
      project: "poe-code"
    });
    expect(document.core).toEqual({ defaultAgent: "claude-code" });
  });

  it("does not write the config when enabling under --dry-run", async () => {
    await writeConfig(fs, { integrations: { braintrust: { enabled: false } } });

    const logs = await runBraintrust(fs, ["enable"], { dryRun: true });

    expect((await readConfig(fs)).integrations.braintrust).toEqual({ enabled: false });
    expect(logs.join("\n")).toContain("would");
  });

  it("does not recover malformed configuration while checking status", async () => {
    await fs.writeFile(configPath, "{ invalid json\n", "utf8");

    await expect(runBraintrustStatus(fs)).rejects.toThrow();

    expect(await fs.readFile(configPath, "utf8")).toBe("{ invalid json\n");
    expect(await fs.readdir(`${homeDir}/.poe-code`)).toEqual(["config.json"]);
  });
});
