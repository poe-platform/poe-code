import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const loginMock = vi.hoisted(() => vi.fn<(options: { apiKey?: string }) => Promise<string>>());

vi.mock("../login.js", () => ({
  login: loginMock
}));

import { registerLoginCommand } from "./login-command.js";

describe("registerLoginCommand", () => {
  let stdout = "";

  beforeEach(() => {
    stdout = "";
    vi.restoreAllMocks();
    loginMock.mockReset();
    loginMock.mockResolvedValue("sk-poe-abcdefghijklmnopqrstuvwxyz12345678");
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    });
  });

  it("calls login with the provided api key and prints confirmation", async () => {
    const program = new Command().name("poe-auth");
    registerLoginCommand(program);

    await program.parseAsync(["login", "--api-key", "test-api-key"], { from: "user" });

    expect(loginMock).toHaveBeenCalledWith({ apiKey: "test-api-key" });
    expect(stdout).toContain("Logged in.");
  });

  it("calls login without an api key when omitted", async () => {
    const program = new Command().name("poe-auth");
    registerLoginCommand(program);

    await program.parseAsync(["login"], { from: "user" });

    expect(loginMock).toHaveBeenCalledWith({ apiKey: undefined });
    expect(stdout).toContain("Logged in.");
  });
});
