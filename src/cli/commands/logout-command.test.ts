import { describe, it, expect, vi, afterEach } from "vitest";
import { Command } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../utils/file-system.js";
import type { ProviderService } from "../service-registry.js";
import { registerLogoutCommand } from "./logout.js";
import { registerUnconfigureCommand } from "./unconfigure.js";
import { createProviderStub } from "../../../tests/provider-stub.js";
import { createSecretStore } from "auth-store";

const cwd = "/repo";
const homeDir = "/home/test";
const configPath = `${homeDir}/.poe-code/config.json`;

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function readStoredApiKey(fs: FileSystem): Promise<string | null> {
  const authFs = {
    readFile: (filePath: string, encoding: BufferEncoding) => fs.readFile(filePath, encoding),
    writeFile: (
      filePath: string,
      data: string | NodeJS.ArrayBufferView,
      opts?: { encoding?: BufferEncoding }
    ) => fs.writeFile(filePath, data, opts),
    mkdir: (directoryPath: string, opts?: { recursive?: boolean }) =>
      fs.mkdir(directoryPath, opts).then(() => undefined),
    unlink: (filePath: string) => fs.unlink(filePath),
    chmod: (filePath: string, mode: number) =>
      fs.chmod ? fs.chmod(filePath, mode) : Promise.resolve()
  };
  const { store } = createSecretStore({
    backendEnvVar: "POE_AUTH_BACKEND",
    fileStore: {
      fs: authFs,
      salt: "poe-code:encrypted-file-auth-store:v1",
      defaultDirectory: ".poe-code",
      defaultFileName: "credentials.enc",
      getHomeDirectory: () => homeDir
    }
  });
  return store.get();
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

  it("deletes config file when no services are configured", async () => {
    const fs = createMemFs();
    const logs: string[] = [];

    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({ apiKey: "test-key" }), { encoding: "utf8" });

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

    await expect(fs.readFile(configPath, "utf8")).rejects.toThrow();
    expect(logs.some((line) => line.includes("Logged out."))).toBe(true);
  });

  it("unconfigures all configured services then deletes config", async () => {
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
      configPath,
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
    await expect(fs.readFile(configPath, "utf8")).rejects.toThrow();
    expect(logs.some((line) => line.includes("Logged out."))).toBe(true);
  });

  it("skips deletion during dry run", async () => {
    const fs = createMemFs();
    const logs: string[] = [];

    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({ apiKey: "test-key" }), { encoding: "utf8" });

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

    const raw = await fs.readFile(configPath, "utf8");
    expect(JSON.parse(raw)).toEqual(expect.objectContaining({ apiKey: "test-key" }));
    expect(logs.some((line) => line.includes("Dry run:"))).toBe(true);
  });

  it("deletes stored API key during logout", async () => {
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

    await container.writeApiKey("sk-poe-TestKeyForLogoutDeletion1234567890abcdefg");

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);
    registerLogoutCommand(program, container);

    await program.parseAsync(["node", "cli", "logout"]);

    const storedKey = await readStoredApiKey(fs);
    expect(storedKey).toBeNull();
  });

  it("handles missing config file gracefully", async () => {
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

    expect(logs.some((line) => line.includes("Already logged out."))).toBe(true);
  });
});
