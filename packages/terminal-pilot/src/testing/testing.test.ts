import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createTerminalPilotCliRepl } from "./cli-repl.js";
import { stripAnsi } from "../ansi.js";

const testingDirectory = path.dirname(fileURLToPath(import.meta.url));
const testCliPath = path.join(testingDirectory, "test-cli.js");
const terminalPilotCliPath = path.join(testingDirectory, "..", "cli.ts");
const tsxPath = path.join(process.cwd(), "node_modules", ".bin", "tsx");

function normalizeOutput(output: string): string {
  return stripAnsi(output).replaceAll("\r", "").replaceAll("\b", "");
}

async function runFixture(scriptName: string, input: string) {
  const scriptPath = path.join(testingDirectory, scriptName);
  const child = spawn(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"]
  });

  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  child.stdin.end(input);

  const [exitCode] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];

  return {
    exitCode,
    output: normalizeOutput(output)
  };
}

async function runTerminalPilotCli(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(tsxPath, [terminalPilotCliPath, ...args], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const [exitCode] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];

  return {
    exitCode,
    stdout: normalizeOutput(stdout).trim(),
    stderr: normalizeOutput(stderr).trim()
  };
}

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

    const created = await repl.runJson([
      "create-session",
      "-s",
      "S1",
      process.execPath,
      testCliPath
    ]);
    expect(created.exitCode).toBe(0);
    expect(created.stderr).toBe("");
    expect(created.stdout).toMatchObject({
      session: "S1",
      pid: expect.any(Number)
    });

    await expect(
      repl.runJson(["wait-for", "What is your name?", "-s", "S1", "-l"])
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
      repl.runJson(["wait-for", "Hello, Ada!", "-s", "S1", "-l"])
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
    expect(JSON.parse(missing.stdout)).toEqual({
      level: "error",
      message: 'Session "S1" was not found. No active sessions are available.'
    });
    expect(missing.stderr).toBe("");
  });
});

describe("terminal-pilot CLI process runner", () => {
  it("preserves terminal sessions across separate CLI processes", async () => {
    const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "terminal-pilot-cli-"));
    const env = {
      ...process.env,
      TERMINAL_PILOT_RUNTIME_DIR: runtimeDir
    };

    try {
      const created = await runTerminalPilotCli(
        ["create-session", "-s", "P1", process.execPath, testCliPath, "--output", "json"],
        env
      );
      expect(created.exitCode).toBe(0);
      expect(JSON.parse(created.stdout)).toMatchObject({
        session: "P1",
        pid: expect.any(Number)
      });

      const prompt = await runTerminalPilotCli(
        [
          "wait-for",
          "-s",
          "P1",
          "What is your name?",
          "--literal",
          "--timeout",
          "5000",
          "--output",
          "json"
        ],
        env
      );
      expect(prompt.exitCode).toBe(0);
      expect(JSON.parse(prompt.stdout)).toMatchObject({
        matched: true,
        line: expect.stringContaining("What is your name?")
      });

      const filled = await runTerminalPilotCli(
        ["fill", "-s", "P1", "Ada\n", "--output", "json"],
        env
      );
      expect(filled.exitCode).toBe(0);

      const greeted = await runTerminalPilotCli(
        [
          "wait-for",
          "-s",
          "P1",
          "Hello, Ada!",
          "--literal",
          "--timeout",
          "5000",
          "--output",
          "json"
        ],
        env
      );
      expect(greeted.exitCode).toBe(0);
      expect(JSON.parse(greeted.stdout)).toMatchObject({
        matched: true,
        line: expect.stringContaining("Hello, Ada!")
      });

      const closed = await runTerminalPilotCli(
        ["close-session", "-s", "P1", "--output", "json"],
        env
      );
      expect(closed.exitCode).toBe(0);
      expect(JSON.parse(closed.stdout)).toMatchObject({ exitCode: 0 });
    } finally {
      await runTerminalPilotCli(["close-session", "-s", "P1", "--output", "json"], env).catch(
        () => undefined
      );
      await rm(runtimeDir, { recursive: true, force: true });
    }
  });
});

describe("interactive testing fixtures", () => {
  it("runs the prompt fixture and greets the provided name", async () => {
    const result = await runFixture("test-cli.js", "Ada\n");

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("What is your name? ");
    expect(result.output).toContain("Hello, Ada!");
  });

  it("greets the final line even when stdin ends without a trailing newline", async () => {
    const result = await runFixture("test-cli.js", "Ada");

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("What is your name? ");
    expect(result.output).toContain("Hello, Ada!");
  });

  it("runs the menu fixture and selects the highlighted option with arrow keys", async () => {
    const result = await runFixture("menu-cli.js", "\u001b[B\u001b[B\r");

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Select an option:");
    expect(result.output).toContain("> Option 1");
    expect(result.output).toContain("You selected: Option 3");
  });

  it("wraps to the last option when pressing ArrowUp from the default selection", async () => {
    const result = await runFixture("menu-cli.js", "\u001b[A\r");

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("You selected: Option 3");
  });

  it("exits with code 130 when interrupted with Ctrl+C", async () => {
    const result = await runFixture("menu-cli.js", "\u0003");

    expect(result.exitCode).toBe(130);
    expect(result.output).not.toContain("You selected:");
  });
});
