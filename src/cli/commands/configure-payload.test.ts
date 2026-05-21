import { describe, it, expect, vi, beforeEach } from "vitest";
import { createConfigurePayload } from "./configure-payload.js";
import { createCliContainer } from "../container.js";
import { createHomeFs, createTestProgram } from "../../../tests/test-helpers.js";
import { createExecutionResources, buildProviderContext, type CommandFlags } from "./shared.js";
import type { FileSystem } from "../../utils/file-system.js";
import { createProviderStub } from "../../../tests/provider-stub.js";

const cwd = "/repo";
const homeDir = "/home/test";

const defaultFlags: CommandFlags = { dryRun: false, assumeYes: true, verbose: false };

function createContainer(fs: FileSystem) {
  return createCliContainer({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: () => {}
  });
}

describe("createConfigurePayload — ActiveProvider fields", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
    createTestProgram();
  });

  it("sets provider.id to the given providerId", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const adapter = container.registry.require("claude-code");
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: {},
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    })) as Record<string, unknown>;

    expect((payload.provider as Record<string, unknown>).id).toBe("poe");
  });

  it("sets provider.credential to the resolved API key", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-resolved-key");

    const adapter = container.registry.require("claude-code");
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: {},
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    })) as Record<string, unknown>;

    expect((payload.provider as Record<string, unknown>).credential).toBe("sk-resolved-key");
  });

  it("sets provider.apiShape and baseUrl from the resolved API shape", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const adapter = container.registry.require("claude-code");
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: {},
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    })) as Record<string, unknown>;

    expect((payload.provider as Record<string, unknown>).apiShape).toBe("anthropic-messages");
    expect((payload.provider as Record<string, unknown>).baseUrl).toBe(
      "https://api.poe.com/anthropic"
    );
  });

  it("prefers a stored per-shape baseUrl over the provider default", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      container.env.configPath,
      JSON.stringify(
        {
          providers: {
            poe: {
              shapeBaseUrls: {
                "anthropic-messages": "https://proxy.example.test/anthropic"
              }
            }
          }
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    const adapter = container.registry.require("claude-code");
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: {},
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    })) as Record<string, unknown>;

    expect((payload.provider as Record<string, unknown>).baseUrl).toBe(
      "https://proxy.example.test/anthropic"
    );
  });

  it("omits provider auth resolution for providerless services", async () => {
    const container = createContainer(fs);
    const resolveApiKeySpy = vi.spyOn(container.options, "resolveApiKey");

    const adapter = createProviderStub({
      name: "providerless-tool",
      label: "Providerless Tool",
      requiresProvider: false
    });
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: {},
      context,
      adapter,
      logger: resources.logger,
      providerId: undefined
    })) as Record<string, unknown>;

    expect(resolveApiKeySpy).not.toHaveBeenCalled();
    expect(payload.provider).toBeUndefined();
    expect(payload.env).toBeDefined();
  });
});
