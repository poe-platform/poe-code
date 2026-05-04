import { beforeEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { resolveConfigPath } from "@poe-code/poe-code-config";
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

async function runBraintrustStatus(fs: FileSystem): Promise<string[]> {
  const logs: string[] = [];
  const program = createProgram({
    fs,
    prompts: vi.fn(),
    env: { cwd, homeDir },
    logger: (message) => logs.push(message)
  });
  vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

  await program.parseAsync(["node", "cli", "braintrust", "status"]);
  return logs;
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

  it("prints peer install guidance when bootstrap reports the Braintrust SDK is missing", async () => {
    await writeConfig(fs, {
      integrations: {
        braintrust: {
          enabled: true,
          apiKey: "key",
          project: "poe-code"
        }
      }
    });
    braintrustMock.bootstrap.mockRejectedValue(
      new Error(
        "Braintrust integration is enabled but the 'braintrust' package is not installed. Run: npm i braintrust"
      )
    );

    const logs = await runBraintrustStatus(fs);

    expect(logs).toContain("not installed: run npm i braintrust");
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
    braintrustMock.bootstrap.mockResolvedValue({
      status: () => ({
        project: "poe-code",
        lastError: "flush failed",
        errorCount: 2
      }),
      shutdown: braintrustMock.shutdown
    });

    const logs = await runBraintrustStatus(fs);

    expect(braintrustMock.bootstrap).toHaveBeenCalledWith(
      expect.objectContaining({
        integrations: {
          braintrust: {
            enabled: true,
            apiKey: "key",
            project: "poe-code"
          }
        }
      })
    );
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
    braintrustMock.bootstrap.mockResolvedValue({
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
});
