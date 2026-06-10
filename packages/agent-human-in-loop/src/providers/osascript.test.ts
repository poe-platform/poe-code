import { promisify } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: Object.assign(vi.fn(), {
    [promisify.custom]: execFileAsyncMock
  })
}));

import { buildScript } from "./osascript-script.js";
import { osascriptProvider } from "./osascript.js";

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

describe("osascriptProvider", () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset();
  });

  it("returns approved for single-dialog approval output", async () => {
    execFileAsyncMock.mockResolvedValue({
      stdout: "Approve\n",
      stderr: ""
    });
    const provider = osascriptProvider({
      binary: "/fake/osascript",
      title: "Need approval"
    });
    const request = { message: 'approve "this" from \\\\tmp' };

    await expect(provider.requestApproval(request)).resolves.toEqual({
      outcome: "approved"
    });

    expect(execFileAsyncMock).toHaveBeenCalledWith("/fake/osascript", [
      "-e",
      buildScript(request, "Need approval")
    ]);
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1);
    expect(execFileAsyncMock.mock.calls[0]?.[1]?.[1]).toContain(
      'approve \\"this\\" from \\\\\\\\tmp'
    );
    expect(execFileAsyncMock.mock.calls[0]?.[1]?.[1]).not.toContain("\n");
  });

  it("returns declined for single-dialog decline output", async () => {
    execFileAsyncMock.mockResolvedValue({
      stdout: "Decline\n",
      stderr: ""
    });
    const provider = osascriptProvider({ binary: "/fake/osascript" });

    await expect(provider.requestApproval({ message: "decline this" })).resolves.toEqual({
      outcome: "declined"
    });
  });

  it("returns approved for two-stage approval output", async () => {
    execFileAsyncMock.mockResolvedValue({
      stdout: "APPROVED\n",
      stderr: ""
    });
    const provider = osascriptProvider({
      binary: "/fake/osascript",
      title: "Need approval"
    });
    const request = {
      message: "continue?",
      declineInputPrompt: "why not?"
    };

    await expect(provider.requestApproval(request)).resolves.toEqual({
      outcome: "approved"
    });

    expect(execFileAsyncMock).toHaveBeenCalledWith("/fake/osascript", [
      "-e",
      buildScript(request, "Need approval")
    ]);
    expect(execFileAsyncMock.mock.calls[0]?.[1]?.[1]).toContain("\n");
  });

  it("returns declined with a reason for two-stage decline output", async () => {
    execFileAsyncMock.mockResolvedValue({
      stdout: "DECLINED:because\n",
      stderr: ""
    });
    const provider = osascriptProvider({ binary: "/fake/osascript" });

    await expect(
      provider.requestApproval({
        message: "continue?",
        declineInputPrompt: "why not?"
      })
    ).resolves.toEqual({
      outcome: "declined",
      reason: "because"
    });
  });

  it("returns declined without a reason when the decline text is empty", async () => {
    execFileAsyncMock.mockResolvedValue({
      stdout: "DECLINED:\n",
      stderr: ""
    });
    const provider = osascriptProvider({ binary: "/fake/osascript" });

    await expect(
      provider.requestApproval({
        message: "continue?",
        declineInputPrompt: "why not?"
      })
    ).resolves.toEqual({
      outcome: "declined"
    });
  });

  it("throws a not-found error when the osascript binary is missing", async () => {
    execFileAsyncMock.mockRejectedValue(
      Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })
    );
    const provider = osascriptProvider({ binary: "/fake/osascript" });

    await expect(provider.requestApproval({ message: "continue?" })).rejects.toThrowError(
      "osascript not found"
    );
  });

  it("wraps spawn failures that only inherit missing-binary codes", async () => {
    execFileAsyncMock.mockRejectedValue(new Error("spawn EACCES"));
    const provider = osascriptProvider({ binary: "/fake/osascript" });

    await withObjectPrototypeCode("ENOENT", async () => {
      await expect(provider.requestApproval({ message: "continue?" })).rejects.toThrowError(
        "osascript failed: Error: spawn EACCES"
      );
    });
  });

  it("treats a dismissed first dialog as a declined result", async () => {
    execFileAsyncMock.mockRejectedValue(
      Object.assign(new Error("execution error: User canceled. (-128)"), {
        stderr: "execution error: User canceled. (-128)\n"
      })
    );
    const provider = osascriptProvider({ binary: "/fake/osascript" });

    await expect(provider.requestApproval({ message: "continue?" })).resolves.toEqual({
      outcome: "declined"
    });
  });

  it("does not treat unrelated -128 diagnostics as a declined result", async () => {
    execFileAsyncMock.mockRejectedValue(
      Object.assign(new Error("execution failed"), {
        stderr: "bad argument (-128) was passed to helper"
      })
    );
    const provider = osascriptProvider({ binary: "/fake/osascript" });

    await expect(provider.requestApproval({ message: "continue?" })).rejects.toThrowError(
      "osascript failed: bad argument (-128) was passed to helper"
    );
  });

  it("throws a wrapped failure when osascript exits with an error", async () => {
    execFileAsyncMock.mockRejectedValue(
      Object.assign(new Error("Command failed"), {
        stdout: "???\n",
        stderr: "execution failed\n"
      })
    );
    const provider = osascriptProvider({ binary: "/fake/osascript" });

    await expect(provider.requestApproval({ message: "continue?" })).rejects.toThrowError(
      "osascript failed: execution failed"
    );
  });
});
