import { beforeEach, describe, expect, it, vi } from "vitest";

const requestApprovalMock = vi.hoisted(() => vi.fn());
const osascriptProviderMock = vi.hoisted(() => vi.fn());

vi.mock("./src/index.js", () => ({
  requestApproval: requestApprovalMock,
  osascriptProvider: osascriptProviderMock,
}));

describe("example.ts", () => {
  beforeEach(() => {
    vi.resetModules();
    requestApprovalMock.mockReset();
    osascriptProviderMock.mockReset();
  });

  it("runs the demo flow and logs ApprovalResult-shaped output", async () => {
    const provider = { id: "provider" };

    osascriptProviderMock.mockReturnValue(provider);
    requestApprovalMock
      .mockResolvedValueOnce({ outcome: "approved" })
      .mockResolvedValueOnce({ outcome: "declined", reason: "Need more info" });

    const consoleLogSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    await import("./example.ts");

    expect(osascriptProviderMock).toHaveBeenCalledWith({
      title: "agent-human-in-loop demo",
    });
    expect(requestApprovalMock).toHaveBeenNthCalledWith(1, {
      message: "Simple approval — click Approve or Decline.",
      provider,
    });
    expect(requestApprovalMock).toHaveBeenNthCalledWith(2, {
      message: "Decline-with-reason — click Decline, then type or cancel.",
      declineInputPrompt: "Why are you declining?",
      provider,
    });
    expect(consoleLogSpy).toHaveBeenNthCalledWith(1, "simple:", {
      outcome: "approved",
    });
    expect(consoleLogSpy).toHaveBeenNthCalledWith(2, "withReason:", {
      outcome: "declined",
      reason: "Need more info",
    });

    consoleLogSpy.mockRestore();
  });
});
