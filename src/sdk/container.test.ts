import { describe, it, expect } from "vitest";
import { createSdkContainer } from "./container.js";

describe("createSdkContainer", () => {
  it("returns a container with all required fields", () => {
    const container = createSdkContainer({ cwd: "/repo", homeDir: "/home/test" });
    expect(container.env).toBeDefined();
    expect(container.fs).toBeDefined();
    expect(container.registry).toBeDefined();
    expect(container.providerRegistry).toBeDefined();
    expect(container.options).toBeDefined();
    expect(container.loggerFactory).toBeDefined();
  });

  it("uses the provided cwd in the environment", () => {
    const container = createSdkContainer({ cwd: "/custom/dir", homeDir: "/home/test" });
    expect(container.env.cwd).toBe("/custom/dir");
  });

  it("uses the provided homeDir in the environment", () => {
    const container = createSdkContainer({ cwd: "/repo", homeDir: "/custom/home" });
    expect(container.env.homeDir).toBe("/custom/home");
  });

  it("registers default providers in the registry", () => {
    const container = createSdkContainer({ cwd: "/repo", homeDir: "/home/test" });
    expect(container.registry.list().length).toBeGreaterThan(0);
  });

  it("registers Poe, Anthropic, OpenAI, and Cloudflare auth providers", () => {
    const container = createSdkContainer({ cwd: "/repo", homeDir: "/home/test" });
    expect(container.providerRegistry.list().map((provider) => provider.id)).toEqual([
      "poe",
      "anthropic",
      "openai",
      "cloudflare"
    ]);
  });

  it("prompts throw in SDK mode (non-interactive)", async () => {
    const container = createSdkContainer({ cwd: "/repo", homeDir: "/home/test" });
    await expect(container.prompts({ name: "x", type: "text" })).rejects.toThrow(
      "SDK does not support interactive prompts"
    );
  });
});
