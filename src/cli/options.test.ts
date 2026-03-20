import { describe, it, expect, vi } from "vitest";
import { createOptionResolvers, isValidApiKeyFormat } from "./options.js";
import { createPromptLibrary } from "./prompts.js";

const VALID_API_KEY = "vnlaoHCddCx7eAGLgdH4iS-g_1MYPsg0JnTRPF1qMuo";
const VALID_SK_POE_API_KEY = "sk-poe-vnlaoHCddCx7eAGLgdH4iSg1MYPsg0JnTRPF1qMuo";
const VALID_SK_POE_API_KEY_WITH_HYPHENS = "sk-poe--jX3djLqPsg0JnTRPF1qMuovnlaoHCddCx7eAGL";
const TOO_SHORT_SK_POE_API_KEY = "sk-poe-abc123";

describe("option resolvers", () => {
  it("uses the login API key prompt when a key is missing", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi
      .fn()
      .mockImplementation(async (descriptor: { name: string }) => ({
        [descriptor.name]: VALID_API_KEY
      }));
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      dryRun: false
    });

    expect(result).toBe(VALID_API_KEY);
    expect(prompts).toHaveBeenCalledTimes(1);
    const [descriptor] = prompts.mock.calls[0]!;
    expect(descriptor.message).toContain("Enter your Poe API key");
  });

  it("strips bracketed paste escape sequences from API key", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    // Simulate tmux/iTerm2 bracketed paste: \x1b[200~ at start, \x1b[201~ at end
    const result = await resolvers.resolveApiKey({
      value: "\x1b[200~my-api-key-here\x1b[201~",
      dryRun: false
    });

    expect(result).toBe("my-api-key-here");
    expect(apiKeyStore.write).toHaveBeenCalledWith("my-api-key-here");
  });

  it("strips multiple bracketed paste sequences from API key", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    const result = await resolvers.resolveApiKey({
      value: "\x1b[200~part1\x1b[201~\x1b[200~part2\x1b[201~",
      dryRun: false
    });

    expect(result).toBe("part1part2");
  });

  it("strips undefinedndefined suffix from prompts library mangled paste", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    // Real world case: key + "undefinedndefined" from mangled bracketed paste
    const result = await resolvers.resolveApiKey({
      value: "vnlaoHCddCx7eAGLgdH4iS-g_1MYPsg0JnTRPF1qMuoundefinedndefined",
      dryRun: false
    });

    expect(result).toBe("vnlaoHCddCx7eAGLgdH4iS-g_1MYPsg0JnTRPF1qMuo");
  });

  it("strips trailing ndefined suffix", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    const result = await resolvers.resolveApiKey({
      value: "my-api-keyndefined",
      dryRun: false
    });

    expect(result).toBe("my-api-key");
  });

  it("confirms env var usage when envValue is present", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      envValue: VALID_API_KEY,
      dryRun: false
    });

    expect(result).toBe(VALID_API_KEY);
    expect(confirmFn).toHaveBeenCalledWith(
      expect.stringContaining("environment")
    );
    expect(apiKeyStore.write).toHaveBeenCalledWith(VALID_API_KEY);
  });

  it("skips env var confirmation when assumeYes is true", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn();
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      envValue: VALID_API_KEY,
      dryRun: false,
      assumeYes: true
    });

    expect(result).toBe(VALID_API_KEY);
    expect(confirmFn).not.toHaveBeenCalled();
    expect(apiKeyStore.write).toHaveBeenCalledWith(VALID_API_KEY);
  });

  it("rejects invalid env key without prompting when assumeYes is true", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi
      .fn()
      .mockImplementation(async (descriptor: { name: string }) => ({
        [descriptor.name]: VALID_API_KEY
      }));
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn();
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    await expect(
      resolvers.resolveApiKey({
        value: undefined,
        envValue: TOO_SHORT_SK_POE_API_KEY,
        dryRun: false,
        assumeYes: true,
        allowStored: false
      })
    ).rejects.toThrow("API key rejected.");

    expect(prompts).not.toHaveBeenCalled();
    expect(confirmFn).not.toHaveBeenCalled();
    expect(apiKeyStore.write).not.toHaveBeenCalled();
  });

  it("falls through to stored credentials when env var is declined", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue("stored-key"),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(false);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      envValue: "env-key",
      dryRun: false
    });

    expect(result).toBe("stored-key");
    expect(confirmFn).toHaveBeenCalledTimes(1);
    expect(apiKeyStore.write).not.toHaveBeenCalled();
  });

  it("skips stored credentials when allowStored is false", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi
      .fn()
      .mockImplementation(async (descriptor: { name: string }) => ({
        [descriptor.name]: VALID_API_KEY
      }));
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue("stored-key"),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      dryRun: false,
      allowStored: false
    });

    expect(result).toBe(VALID_API_KEY);
    expect(prompts).toHaveBeenCalledTimes(1);
    expect(apiKeyStore.write).toHaveBeenCalledWith(VALID_API_KEY);
  });

  it("re-prompts when prompted key has invalid format and user rejects it", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi
      .fn()
      .mockImplementationOnce(async (descriptor: { name: string }) => ({
        [descriptor.name]: "bad key!"
      }))
      .mockImplementationOnce(async (descriptor: { name: string }) => ({
        [descriptor.name]: VALID_API_KEY
      }));
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(false);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      dryRun: false,
      allowStored: false
    });

    expect(result).toBe(VALID_API_KEY);
    expect(prompts).toHaveBeenCalledTimes(2);
    expect(confirmFn).toHaveBeenCalledTimes(1);
    expect(apiKeyStore.write).toHaveBeenCalledWith(VALID_API_KEY);
  });

  it("re-prompts when prompted key is missing", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi
      .fn()
      .mockImplementationOnce(async () => ({}))
      .mockImplementationOnce(async (descriptor: { name: string }) => ({
        [descriptor.name]: VALID_API_KEY
      }));
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn();
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      dryRun: false,
      allowStored: false
    });

    expect(result).toBe(VALID_API_KEY);
    expect(prompts).toHaveBeenCalledTimes(2);
    expect(confirmFn).not.toHaveBeenCalled();
    expect(apiKeyStore.write).toHaveBeenCalledWith(VALID_API_KEY);
  });

  it("re-prompts when prompted key is empty", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi
      .fn()
      .mockImplementationOnce(async (descriptor: { name: string }) => ({
        [descriptor.name]: ""
      }))
      .mockImplementationOnce(async (descriptor: { name: string }) => ({
        [descriptor.name]: VALID_API_KEY
      }));
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn();
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      dryRun: false,
      allowStored: false
    });

    expect(result).toBe(VALID_API_KEY);
    expect(prompts).toHaveBeenCalledTimes(2);
    expect(confirmFn).not.toHaveBeenCalled();
    expect(apiKeyStore.write).toHaveBeenCalledWith(VALID_API_KEY);
  });

  it("falls through to prompt when env var declined and no stored key", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi
      .fn()
      .mockImplementation(async (descriptor: { name: string }) => ({
        [descriptor.name]: VALID_API_KEY
      }));
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(false);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      envValue: "env-key",
      dryRun: false
    });

    expect(result).toBe(VALID_API_KEY);
    expect(prompts).toHaveBeenCalledTimes(1);
  });

  it("confirms when key has invalid format", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    const result = await resolvers.resolveApiKey({
      value: "has spaces in it",
      dryRun: false
    });

    expect(result).toBe("has spaces in it");
    expect(confirmFn).toHaveBeenCalledWith(
      expect.stringContaining("format")
    );
  });

  it("does not confirm format for valid keys", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn();
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    await resolvers.resolveApiKey({
      value: VALID_SK_POE_API_KEY,
      dryRun: false
    });

    expect(confirmFn).not.toHaveBeenCalled();
  });

  it("rejects invalid format without prompting when assumeYes is true", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn();
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    await expect(
      resolvers.resolveApiKey({
        value: "bad key!",
        dryRun: false,
        assumeYes: true
      })
    ).rejects.toThrow("API key rejected.");
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it("throws when user rejects invalid format", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(false);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    await expect(
      resolvers.resolveApiKey({
        value: "bad key!",
        dryRun: false
      })
    ).rejects.toThrow();
  });

  it("skips format check for stored credentials", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue("stored with spaces"),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn();
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      dryRun: false
    });

    expect(result).toBe("stored with spaces");
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it("auto-selects the only available model without prompting", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn().mockResolvedValue({});
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn
    });

    const result = await resolvers.resolveModel({
      value: undefined,
      assumeDefault: false,
      defaultValue: "Default-Model",
      choices: [{ title: "Only Choice", value: "Unique-Model" }],
      label: "Test Model"
    });

    expect(result).toBe("Unique-Model");
    expect(prompts).not.toHaveBeenCalled();
  });
});

describe("isValidApiKeyFormat", () => {
  it("accepts sk-poe- prefixed keys", () => {
    expect(isValidApiKeyFormat(VALID_SK_POE_API_KEY)).toBe(true);
  });

  it("accepts sk-poe- keys with hyphens and underscores in hash", () => {
    expect(isValidApiKeyFormat(VALID_SK_POE_API_KEY_WITH_HYPHENS)).toBe(true);
  });

  it("accepts legacy alphanumeric hash keys", () => {
    expect(
      isValidApiKeyFormat("vnlaoHCddCx7eAGLgdH4iSg1MYPsg0JnTRPF1qMuo")
    ).toBe(true);
  });

  it("accepts keys with hyphens and underscores", () => {
    expect(isValidApiKeyFormat(VALID_API_KEY)).toBe(true);
  });

  it("rejects legacy keys shorter than 80% expected length", () => {
    expect(isValidApiKeyFormat("vnlaoHCddCx7eAGLgdH4iS-g_1MYPsg0Jn")).toBe(false);
  });

  it("rejects sk-poe- keys shorter than 80% expected length", () => {
    expect(isValidApiKeyFormat(TOO_SHORT_SK_POE_API_KEY)).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidApiKeyFormat("")).toBe(false);
  });

  it("rejects keys with spaces", () => {
    expect(isValidApiKeyFormat("key with spaces")).toBe(false);
  });

  it("rejects keys with special characters", () => {
    expect(isValidApiKeyFormat("key!@#$%")).toBe(false);
  });

  it("rejects bare sk-poe- prefix with no hash", () => {
    expect(isValidApiKeyFormat("sk-poe-")).toBe(false);
  });

  it("rejects sk-poe- prefix with special chars in hash", () => {
    expect(isValidApiKeyFormat("sk-poe-abc!def")).toBe(false);
  });
});
