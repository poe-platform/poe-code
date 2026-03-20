import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const checkAuthMock = vi.hoisted(() =>
  vi.fn<() => Promise<{ email: string; balance: number | null } | null>>()
);

vi.mock("../check-auth.js", () => ({
  checkAuth: checkAuthMock
}));

import { registerWhoamiCommand } from "./whoami-command.js";

describe("registerWhoamiCommand", () => {
  let stdout = "";
  let stderr = "";

  beforeEach(() => {
    stdout = "";
    stderr = "";
    process.exitCode = undefined;
    vi.restoreAllMocks();
    checkAuthMock.mockReset();
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    });
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it("prints the authenticated email and balance", async () => {
    const program = new Command().name("poe-auth");
    checkAuthMock.mockResolvedValue({
      email: "user@example.com",
      balance: 1500
    });
    registerWhoamiCommand(program);

    await program.parseAsync(["whoami"], { from: "user" });

    expect(checkAuthMock).toHaveBeenCalledTimes(1);
    expect(stdout).toContain("user@example.com");
    expect(stdout).toContain("1500");
    expect(stderr).toBe("");
    expect(process.exitCode).toBeUndefined();
  });

  it("prints machine-readable JSON with --json", async () => {
    const program = new Command().name("poe-auth");
    checkAuthMock.mockResolvedValue({
      email: "user@example.com",
      balance: 42
    });
    registerWhoamiCommand(program);

    await program.parseAsync(["whoami", "--json"], { from: "user" });

    expect(stdout).toBe('{"email":"user@example.com","balance":42}\n');
    expect(stderr).toBe("");
  });

  it("prints an error to stderr and sets exit code 1 when not logged in", async () => {
    const program = new Command().name("poe-auth");
    checkAuthMock.mockResolvedValue(null);
    registerWhoamiCommand(program);

    await program.parseAsync(["whoami"], { from: "user" });

    expect(checkAuthMock).toHaveBeenCalledTimes(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("Not logged in.");
    expect(process.exitCode).toBe(1);
  });
});
