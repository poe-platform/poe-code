import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserError } from "../user-error.js";

const mockedProcess = vi.hoisted(() => ({
  platform: "darwin" as NodeJS.Platform
}));

const osascriptRequestApprovalMock = vi.hoisted(() => vi.fn());
const osascriptProviderMock = vi.hoisted(() => vi.fn());

vi.mock("node:process", () => ({
  default: mockedProcess
}));

vi.mock("@poe-code/agent-human-in-loop", () => ({
  osascriptProvider: osascriptProviderMock
}));

describe("defaultProviderForPlatform", () => {
  beforeEach(() => {
    vi.resetModules();
    mockedProcess.platform = "darwin";
    osascriptRequestApprovalMock.mockReset();
    osascriptProviderMock.mockReset();
    osascriptProviderMock.mockImplementation(() => ({
      id: "osascript",
      requestApproval: osascriptRequestApprovalMock
    }));
  });

  it("returns the osascript provider on darwin without invoking it during construction", async () => {
    const { defaultProviderForPlatform } = await import("./default-provider.js");

    expect(osascriptProviderMock).not.toHaveBeenCalled();

    const provider = defaultProviderForPlatform();

    expect(provider.id).toBe("osascript");
    expect(osascriptProviderMock).toHaveBeenCalledWith({
      title: "Approval needed"
    });
    expect(osascriptRequestApprovalMock).not.toHaveBeenCalled();
  });

  it("throws the documented UserError on non-darwin platforms", async () => {
    mockedProcess.platform = "linux";

    const { defaultProviderForPlatform } = await import("./default-provider.js");

    await expect(
      defaultProviderForPlatform().requestApproval({
        message: "Approve deploy?"
      })
    ).rejects.toMatchObject({
      name: UserError.name,
      message:
        "No human-in-loop provider is configured. Pass {humanInLoop: {provider: ...}} to runCLI / createMCPServer / createSDK, or run on macOS to use the default osascript provider."
    });
    expect(osascriptProviderMock).not.toHaveBeenCalled();
  });

  it("memoizes the fallback provider instance on non-darwin platforms", async () => {
    mockedProcess.platform = "linux";

    const { defaultProviderForPlatform } = await import("./default-provider.js");

    const firstProvider = defaultProviderForPlatform();
    const secondProvider = defaultProviderForPlatform();

    expect(firstProvider.id).toBe("noProviderConfigured");
    expect(firstProvider).toBe(secondProvider);
    expect(osascriptProviderMock).not.toHaveBeenCalled();
  });

  it("memoizes the provider instance within the same runtime instance", async () => {
    const { defaultProviderForPlatform } = await import("./default-provider.js");

    const firstProvider = defaultProviderForPlatform();
    const secondProvider = defaultProviderForPlatform();

    expect(firstProvider).toBe(secondProvider);
    expect(osascriptProviderMock).toHaveBeenCalledTimes(1);
  });

  it("creates a fresh memoized provider for each module instance", async () => {
    const firstModule = await import("./default-provider.js");
    const firstProvider = firstModule.defaultProviderForPlatform();

    vi.resetModules();
    mockedProcess.platform = "darwin";
    osascriptRequestApprovalMock.mockReset();
    osascriptProviderMock.mockReset();
    osascriptProviderMock.mockImplementation(() => ({
      id: "osascript:fresh-runtime",
      requestApproval: osascriptRequestApprovalMock
    }));

    const secondModule = await import("./default-provider.js");
    const secondProvider = secondModule.defaultProviderForPlatform();

    expect(firstProvider).not.toBe(secondProvider);
    expect(secondProvider.id).toBe("osascript:fresh-runtime");
    expect(osascriptProviderMock).toHaveBeenCalledTimes(1);
  });
});
