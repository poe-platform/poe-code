import { describe, expect, it, vi } from "vitest";
import type { AcpModel } from "./acp-core.js";
import type { AgentPlugin, Provider, ProviderContext } from "./plugin-types.js";
import {
  collectProviders,
  DuplicateProviderNameError,
  ProviderResolutionError,
  resolveProvider,
} from "./resolve-provider.js";

function createModel(): AcpModel {
  return {
    complete: vi.fn(async () => ({ message: { role: "assistant", content: "ok" } })),
  };
}

function createProvider(
  name: string,
  options: {
    supports?: (modelId: string) => boolean;
    createModel?: (modelId: string, ctx: ProviderContext) => AcpModel | Promise<AcpModel>;
  } = {},
): Provider {
  return {
    name,
    supports: options.supports ?? (() => false),
    createModel: options.createModel ?? (() => createModel()),
  };
}

describe("collectProviders", () => {
  it("throws DuplicateProviderNameError when two plugins register the same provider name", () => {
    const plugins: AgentPlugin[] = [
      {
        name: "plugin-one",
        providers: [createProvider("shared")],
      },
      {
        name: "plugin-two",
        providers: [createProvider("shared")],
      },
    ];

    expect(() => collectProviders(plugins)).toThrowError(DuplicateProviderNameError);

    try {
      collectProviders(plugins);
      throw new Error("Expected collectProviders to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateProviderNameError);
      expect(error).toMatchObject({
        providerName: "shared",
        pluginEntries: ["plugin-one.providers[0]", "plugin-two.providers[0]"],
      });
      expect((error as Error).message).toContain("shared");
      expect((error as Error).message).toContain("plugin-one.providers[0]");
      expect((error as Error).message).toContain("plugin-two.providers[0]");
    }
  });

  it("throws DuplicateProviderNameError when the same plugin registers the same provider name twice", () => {
    const plugins: AgentPlugin[] = [
      {
        name: "plugin-one",
        providers: [createProvider("shared"), createProvider("shared")],
      },
    ];

    expect(() => collectProviders(plugins)).toThrowError(DuplicateProviderNameError);

    try {
      collectProviders(plugins);
      throw new Error("Expected collectProviders to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateProviderNameError);
      expect(error).toMatchObject({
        providerName: "shared",
        pluginEntries: ["plugin-one.providers[0]", "plugin-one.providers[1]"],
      });
    }
  });

  it("ignores plugins with empty providers arrays", () => {
    const provider = createProvider("alpha");
    const plugins: AgentPlugin[] = [
      { name: "empty", providers: [] },
      { name: "filled", providers: [provider] },
    ];

    expect(collectProviders(plugins)).toEqual([provider]);
  });
});

describe("resolveProvider", () => {
  it("returns the first provider that supports the model id", () => {
    const firstSupports = vi.fn(() => true);
    const secondSupports = vi.fn(() => true);
    const first = createProvider("first", { supports: firstSupports });
    const second = createProvider("second", { supports: secondSupports });

    const resolved = resolveProvider([first, second], "model-a");

    expect(resolved).toBe(first);
    expect(firstSupports).toHaveBeenCalledWith("model-a");
    expect(secondSupports).not.toHaveBeenCalled();
  });

  it("throws ProviderResolutionError listing registered provider names in order", () => {
    const providers = [
      createProvider("alpha", { supports: () => false }),
      createProvider("beta", { supports: () => false }),
      createProvider("gamma", { supports: () => false }),
    ];

    expect(() => resolveProvider(providers, "missing-model")).toThrowError(ProviderResolutionError);

    try {
      resolveProvider(providers, "missing-model");
      throw new Error("Expected resolveProvider to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderResolutionError);
      expect(error).toMatchObject({
        modelId: "missing-model",
        providerNames: ["alpha", "beta", "gamma"],
      });
      expect((error as Error).message).toBe(
        'No provider supports model "missing-model". Registered providers: alpha, beta, gamma.'
      );
    }
  });

  it("throws ProviderResolutionError when no providers are registered", () => {
    expect(() => resolveProvider([], "missing-model")).toThrowError(ProviderResolutionError);

    try {
      resolveProvider([], "missing-model");
      throw new Error("Expected resolveProvider to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderResolutionError);
      expect(error).toMatchObject({
        modelId: "missing-model",
        providerNames: [],
      });
      expect((error as Error).message).toBe(
        'No provider supports model "missing-model". Registered providers: (none).'
      );
    }
  });

  it("wraps supports() errors with the provider name and does not fall through", () => {
    const supportsError = new Error("bad provider config");
    const firstSupports = vi.fn(() => {
      throw supportsError;
    });
    const secondSupports = vi.fn(() => true);
    const first = createProvider("first", { supports: firstSupports });
    const second = createProvider("second", { supports: secondSupports });

    expect(() => resolveProvider([first, second], "model-a")).toThrowError(ProviderResolutionError);
    expect(secondSupports).not.toHaveBeenCalled();

    try {
      resolveProvider([first, second], "model-a");
      throw new Error("Expected resolveProvider to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderResolutionError);
      expect(error).toMatchObject({
        modelId: "model-a",
        providerNames: ["first", "second"],
        providerName: "first",
        cause: supportsError,
      });
      expect((error as Error).message).toContain("first");
    }
  });

  it("does not fall through after the first matching provider even if createModel() throws", async () => {
    const createModelError = new Error("createModel failed");
    const first = createProvider("first", {
      supports: () => true,
      createModel: async () => {
        throw createModelError;
      },
    });
    const secondSupports = vi.fn(() => true);
    const second = createProvider("second", { supports: secondSupports });

    const resolved = resolveProvider([first, second], "model-a");

    await expect(resolved.createModel("model-a", {
      fetch: globalThis.fetch,
      options: {},
    })).rejects.toBe(createModelError);
    expect(secondSupports).not.toHaveBeenCalled();
  });
});
