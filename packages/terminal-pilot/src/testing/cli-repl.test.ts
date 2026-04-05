import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createTerminalPilotCliRepl } from "./cli-repl.js";

const testingDirectory = path.dirname(fileURLToPath(import.meta.url));
const testCliPath = path.join(testingDirectory, "test-cli.js");

describe("terminal-pilot CLI REPL runner", () => {
  const repls: Array<ReturnType<typeof createTerminalPilotCliRepl>> = [];

  afterEach(async () => {
    await Promise.all(repls.map(async (repl) => repl.close()));
    repls.length = 0;
  });

  it("preserves terminal sessions across repeated CLI invocations", async () => {
    const repl = createTerminalPilotCliRepl();
    repls.push(repl);

    await expect(repl.runJson(["list-sessions"])).resolves.toEqual({
      exitCode: 0,
      stderr: "",
      stdout: {
        sessions: []
      }
    });

    const created = await repl.runJson(["create-session", "-s", "S1", process.execPath, testCliPath]);
    expect(created.exitCode).toBe(0);
    expect(created.stderr).toBe("");
    expect(created.stdout).toMatchObject({
      session: "S1",
      pid: expect.any(Number)
    });

    await expect(
      repl.runJson(["wait-for", "-s", "S1", "-l", "What is your name?"])
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: {
        matched: true,
        line: expect.stringContaining("What is your name?")
      }
    });

    await expect(repl.runJson(["fill", "-s", "S1", "Ada\n"])).resolves.toEqual({
      exitCode: 0,
      stderr: "",
      stdout: {
        ok: true
      }
    });

    await expect(
      repl.runJson(["wait-for", "-s", "S1", "-l", "Hello, Ada!"])
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: {
        matched: true,
        line: expect.stringContaining("Hello, Ada!")
      }
    });

    await expect(repl.runJson(["close-session", "-s", "S1"])).resolves.toMatchObject({
      exitCode: 0,
      stdout: {
        exitCode: 0
      }
    });

    const missing = await repl.run(["get-session", "-s", "S1", "--output", "json"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain('Session "S1" was not found.');
  });
});
