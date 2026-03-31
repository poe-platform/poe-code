import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripAnsi } from "../ansi.js";

const testingDirectory = path.dirname(fileURLToPath(import.meta.url));

function normalizeOutput(output: string): string {
  return stripAnsi(output).replaceAll("\r", "").replaceAll("\b", "");
}

async function runFixture(scriptName: string, input: string) {
  const scriptPath = path.join(testingDirectory, scriptName);
  const child = spawn(scriptPath, [], {
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

describe("interactive testing fixtures", () => {
  it("runs the prompt fixture and greets the provided name", async () => {
    const result = await runFixture("test-cli.ts", "Ada\n");

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("What is your name? ");
    expect(result.output).toContain("Hello, Ada!");
  });

  it("greets the final line even when stdin ends without a trailing newline", async () => {
    const result = await runFixture("test-cli.ts", "Ada");

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("What is your name? ");
    expect(result.output).toContain("Hello, Ada!");
  });

  it("runs the menu fixture and selects the highlighted option with arrow keys", async () => {
    const result = await runFixture("menu-cli.ts", "\u001b[B\u001b[B\r");

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Select an option:");
    expect(result.output).toContain("> Option 1");
    expect(result.output).toContain("You selected: Option 3");
  });

  it("wraps to the last option when pressing ArrowUp from the default selection", async () => {
    const result = await runFixture("menu-cli.ts", "\u001b[A\r");

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("You selected: Option 3");
  });

  it("exits with code 130 when interrupted with Ctrl+C", async () => {
    const result = await runFixture("menu-cli.ts", "\u0003");

    expect(result.exitCode).toBe(130);
    expect(result.output).not.toContain("You selected:");
  });
});
