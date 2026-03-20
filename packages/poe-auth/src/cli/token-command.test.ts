import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const getTokenMock = vi.hoisted(() => vi.fn<() => Promise<string | null>>());

vi.mock("../get-token.js", () => ({
  getToken: getTokenMock
}));

import { registerTokenCommand } from "./token-command.js";

describe("registerTokenCommand", () => {
  let stdout = "";
  let stderr = "";

  beforeEach(() => {
    stdout = "";
    stderr = "";
    process.exitCode = undefined;
    vi.restoreAllMocks();
    getTokenMock.mockReset();
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

  it("prints the stored api key to stdout", async () => {
    const program = new Command().name("poe-auth");
    getTokenMock.mockResolvedValue("sk-poe-abcdefghijklmnopqrstuvwxyz12345678");
    registerTokenCommand(program);

    await program.parseAsync(["token"], { from: "user" });

    expect(getTokenMock).toHaveBeenCalledTimes(1);
    expect(stdout).toBe("sk-poe-abcdefghijklmnopqrstuvwxyz12345678\n");
    expect(stderr).toBe("");
    expect(process.exitCode).toBeUndefined();
  });

  it("prints an error to stderr and sets exit code 1 when no key is stored", async () => {
    const program = new Command().name("poe-auth");
    getTokenMock.mockResolvedValue(null);
    registerTokenCommand(program);

    await program.parseAsync(["token"], { from: "user" });

    expect(getTokenMock).toHaveBeenCalledTimes(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("No API key stored.");
    expect(process.exitCode).toBe(1);
  });
});
