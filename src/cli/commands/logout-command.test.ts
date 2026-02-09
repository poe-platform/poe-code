import { describe, it, expect, vi, afterEach } from "vitest";
import { Command } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../utils/file-system.js";
import type { ProviderService } from "../service-registry.js";
import { registerLogoutCommand } from "./logout.js";
import { registerUnconfigureCommand } from "./unconfigure.js";
import { createProviderStub } from "../../../tests/provider-stub.js";

const cwd = "/repo";
const homeDir = "/home/test";
const credentialsPath = `${homeDir}/.poe-code/credentials.json`;

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function createBaseProgram(): Command {
  const program = new Command();
  program
    .name("poe-code")
    .option("-y, --yes")
    .option("--dry-run")
    .option("--verbose")
    .exitOverride();
  return program;
}

describe("logout command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes credentials file when no services are configured", async () => {
    const fs = createMemFs();
    const logs: string[] = [];

    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      credentialsPath,
      JSON.stringify({ apiKey: "test-key" }),
      { encoding: "utf8" }
    );

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);
    registerLogoutCommand(program, container);

    await program.parseAsync(["node", "cli", "logout"]);

    await expect(fs.readFile(credentialsPath, "utf8")).rejects.toThrow();
    expect(
      logs.some((line) => line.includes("Logged out."))
    ).toBe(true);
  });

  it("unconfigures all configured services then deletes credentials", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const unconfigureSpy = vi.fn();

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    const adapter: ProviderService = createProviderStub({
      name: "test-service",
      label: "Test Service",
      async unconfigure(context) {
        unconfigureSpy(context.options);
        return true;
      }
    });

    container.registry.register(adapter);

    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      credentialsPath,
      JSON.stringify({
        apiKey: "test-key",
        configured_services: {
          "test-service": { files: ["/some/file.json"] }
        }
      }),
      { encoding: "utf8" }
    );

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);
    registerLogoutCommand(program, container);

    await program.parseAsync(["node", "cli", "logout"]);

    expect(unconfigureSpy).toHaveBeenCalledTimes(1);
    await expect(fs.readFile(credentialsPath, "utf8")).rejects.toThrow();
    expect(
      logs.some((line) => line.includes("Logged out."))
    ).toBe(true);
  });

  it("skips deletion during dry run", async () => {
    const fs = createMemFs();
    const logs: string[] = [];

    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      credentialsPath,
      JSON.stringify({ apiKey: "test-key" }),
      { encoding: "utf8" }
    );

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);
    registerLogoutCommand(program, container);

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: true } as any);

    await program.parseAsync(["node", "cli", "--dry-run", "logout"]);

    const raw = await fs.readFile(credentialsPath, "utf8");
    expect(JSON.parse(raw)).toEqual(
      expect.objectContaining({ apiKey: "test-key" })
    );
    expect(
      logs.some((line) => line.includes("Dry run:"))
    ).toBe(true);
  });

  it("handles missing credentials file gracefully", async () => {
    const fs = createMemFs();
    const logs: string[] = [];

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);
    registerLogoutCommand(program, container);

    await program.parseAsync(["node", "cli", "logout"]);

    expect(
      logs.some((line) => line.includes("Already logged out."))
    ).toBe(true);
  });
});
