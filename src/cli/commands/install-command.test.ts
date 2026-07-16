import { describe, it, expect, beforeEach, vi } from "vitest";
import { Command } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import { createCliContainer } from "../container.js";
import { registerInstallCommand } from "./install.js";
import { createProviderStub } from "../../../tests/provider-stub.js";
import type { FileSystem } from "../utils/file-system.js";
import type { ProviderService } from "../service-registry.js";

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

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run");
  return program;
}

function createInstallProgram(install: ProviderService["install"], logs: string[] = []): Command {
  const container = createCliContainer({
    fs: createMemFs(),
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: (message) => {
      logs.push(message);
    }
  });
  container.registry.register(createProviderStub({
    name: "test-service",
    label: "Test Service",
    install
  }));

  const program = createBaseProgram();
  registerInstallCommand(program, container);
  return program;
}

describe("install command progress", () => {
  beforeEach(() => {
    withSpinnerMock.mockClear();
  });

  it("wraps provider installs in a progress spinner", async () => {
    const install = vi.fn(async () => {});
    const program = createInstallProgram(install);

    await program.parseAsync(["node", "cli", "install", "test-service"]);

    expect(install).toHaveBeenCalledOnce();
    expect(withSpinnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Installing Test Service...",
        fn: expect.any(Function)
      })
    );
  });

  it("does not show a progress spinner during dry runs", async () => {
    const install = vi.fn(async () => {});
    const program = createInstallProgram(install);

    await program.parseAsync(["node", "cli", "--dry-run", "install", "test-service"]);

    expect(install).toHaveBeenCalledOnce();
    expect(withSpinnerMock).not.toHaveBeenCalled();
  });
});

describe("install command outcome reporting", () => {
  beforeEach(() => {
    withSpinnerMock.mockClear();
  });

  it("reports the agent as already installed when the provider changed nothing", async () => {
    const logs: string[] = [];
    const program = createInstallProgram(async () => false, logs);

    await program.parseAsync(["node", "cli", "install", "test-service"]);

    expect(logs).toContain("Test Service is already installed.");
    expect(logs).not.toContain("Installed Test Service.");
  });

  it("reports a completed install when the provider installed the agent", async () => {
    const logs: string[] = [];
    const program = createInstallProgram(async () => true, logs);

    await program.parseAsync(["node", "cli", "install", "test-service"]);

    expect(logs).toContain("Installed Test Service.");
    expect(logs).not.toContain("Test Service is already installed.");
  });

  it("reports a completed install when the provider reports no outcome", async () => {
    const logs: string[] = [];
    const program = createInstallProgram(async () => {}, logs);

    await program.parseAsync(["node", "cli", "install", "test-service"]);

    expect(logs).toContain("Installed Test Service.");
  });

  it("does not claim success when the provider install fails", async () => {
    const logs: string[] = [];
    const program = createInstallProgram(async () => {
      throw new Error("npm install exited with code 1");
    }, logs);

    await expect(program.parseAsync(["node", "cli", "install", "test-service"])).rejects.toThrow(
      /npm install exited with code 1/
    );

    expect(logs.some((line) => line.includes("Installed Test Service"))).toBe(false);
  });
});
