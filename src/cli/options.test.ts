import { describe, it, expect, vi } from "vitest";
import { createOptionResolvers } from "./options.js";
import { createPromptLibrary } from "./prompts.js";

describe("option resolvers", () => {
  it("uses the login API key prompt when a key is missing", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi
      .fn()
      .mockImplementation(async (descriptor: { name: string }) => ({
        [descriptor.name]: "prompt-key"
      }));
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      dryRun: false
    });

    expect(result).toBe("prompt-key");
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
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore
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
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore
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
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore
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
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore
    });

    const result = await resolvers.resolveApiKey({
      value: "my-api-keyndefined",
      dryRun: false
    });

    expect(result).toBe("my-api-key");
  });

  it("auto-selects the only available model without prompting", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn().mockResolvedValue({});
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore
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
