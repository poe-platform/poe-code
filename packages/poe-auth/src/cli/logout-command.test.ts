import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const logoutMock = vi.hoisted(() => vi.fn<() => Promise<void>>());

vi.mock("../logout.js", () => ({
  logout: logoutMock
}));

import { registerLogoutCommand } from "./logout-command.js";

describe("registerLogoutCommand", () => {
  let stdout = "";

  beforeEach(() => {
    stdout = "";
    vi.restoreAllMocks();
    logoutMock.mockReset();
    logoutMock.mockResolvedValue(undefined);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    });
  });

  it("calls logout and prints confirmation", async () => {
    const program = new Command().name("poe-auth");
    registerLogoutCommand(program);

    await program.parseAsync(["logout"], { from: "user" });

    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(stdout).toContain("Logged out.");
  });
});
