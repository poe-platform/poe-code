import { describe, it, expect, vi, beforeEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../utils/file-system.js";
import { createProviderStub } from "../../tests/provider-stub.js";

vi.mock("./isolated-env.js", () => ({
  applyIsolatedEnvRepairs: vi.fn(async () => {}),
  resolveIsolatedEnvDetails: vi.fn(async () => ({
    agentBinary: "demo-agent",
    env: {},
    configProbePath: "/home/test/.poe-code/test-service/probe.txt"
  })),
  resolveCliSettings: vi.fn(async () => ({})),
  isolatedConfigExists: vi.fn(async () => true)
}));

vi.mock("./commands/ensure-isolated-config.js", () => ({
  ensureIsolatedConfigForService: vi.fn(async () => {})
}));

import { createPoeCodeCommandRunner } from "./poe-code-command-runner.js";
import * as isolatedEnv from "./isolated-env.js";
import { createCliContainer } from "./container.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

const isolatedServiceAdapter = createProviderStub({
  name: "test-service",
  label: "Test",
  isolatedEnv: {
    agentBinary: "demo-agent",
    configProbe: { kind: "isolatedFile" as const, relativePath: "probe.txt" },
    env: {}
  }
});

describe("poe-code-command-runner credential resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses POE_API_KEY env var as credential when set", async () => {
    const baseRunner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: { POE_API_KEY: "sk-from-env" } },
      logger: () => {}
    });
    container.registry.register(isolatedServiceAdapter);

    const runner = createPoeCodeCommandRunner({ getContainer: () => container, baseRunner });
    await runner("poe-code", ["wrap", "test-service"], {});

    expect(isolatedEnv.resolveIsolatedEnvDetails).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ credential: "sk-from-env" })
    );
  });

  it("falls back to stored API key when POE_API_KEY is not set", async () => {
    const baseRunner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
      logger: () => {}
    });
    vi.spyOn(container, "readApiKey").mockResolvedValue("sk-stored-key");
    container.registry.register(isolatedServiceAdapter);

    const runner = createPoeCodeCommandRunner({ getContainer: () => container, baseRunner });
    await runner("poe-code", ["wrap", "test-service"], {});

    expect(isolatedEnv.resolveIsolatedEnvDetails).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ credential: "sk-stored-key" })
    );
  });
});
