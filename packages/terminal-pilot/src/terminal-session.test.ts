import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { TerminalSession } from "./terminal-session.js";

const testingDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "testing");
const testCliPath = path.join(testingDirectory, "test-cli.js");

function createSession(id: string) {
  return new TerminalSession({
    id,
    command: process.execPath,
    args: [testCliPath],
    cwd: process.cwd(),
    env: process.env,
    cols: 80,
    rows: 24,
    observe: false
  });
}

describe("TerminalSession", () => {
  const sessions: TerminalSession[] = [];

  afterEach(async () => {
    await Promise.all(
      sessions.map(async (session) => {
        try {
          await session.close();
        } catch {
          // noop
        }
      })
    );
    sessions.length = 0;
  });

  it("spawns a session, types input, presses Enter, waits for output, and exposes screen/history", async () => {
    const session = createSession("session-1");
    sessions.push(session);

    expect(session.id).toBe("session-1");
    expect(session.pid).toBeGreaterThan(0);
    expect(session.exitCode).toBeNull();

    const exitEvents: number[] = [];
    session.on("exit", (code) => {
      exitEvents.push(code);
    });

    await session.waitFor("What is your name?");
    await session.type("Ada");
    await session.press("Enter");

    const matched = await session.waitFor(/Hello, Ada!/);
    expect(matched).toBe("Hello, Ada!");

    await session.waitForQuiet(200);

    const screen = await session.screen();
    expect(screen.contains("Hello, Ada!")).toBe(true);
    expect(screen.text).toContain("What is your name?");

    const history = await session.history();
    expect(history.join("\n")).toContain("What is your name?");
    expect(history.join("\n")).toContain("Hello, Ada!");

    const lastLine = await session.history({ last: 1 });
    expect(lastLine).toHaveLength(1);
    expect(lastLine[0]).toContain("Hello, Ada!");

    const code = await session.close();
    expect(code).toBe(0);
    expect(session.exitCode).toBe(0);
    expect(exitEvents).toContain(0);
  });

  it("supports raw send, waitForQuiet, resize, regexp waits, and idempotent close", async () => {
    const session = createSession("session-2");
    sessions.push(session);

    await session.waitFor("What is your name?");

    const expression = /Hello, Grace!/g;
    await session.send("Grace\r");

    const matched = await session.waitFor(expression);
    expect(matched).toBe("Hello, Grace!");
    expect(expression.lastIndex).toBe(0);

    await session.waitForQuiet(200);
    await session.resize(100, 30);

    const screen = await session.screen();
    expect(screen.size).toEqual({ cols: 100, rows: 30 });
    expect(screen.contains("Hello, Grace!")).toBe(true);

    const history = await session.history();
    expect(history.some((line) => line.includes("What is your name?"))).toBe(true);
    expect(history.some((line) => line.includes("Hello, Grace!"))).toBe(true);

    const recentHistory = await session.history({ last: 3 });
    expect(recentHistory.some((line) => line.includes("Hello, Grace!"))).toBe(true);

    expect(await session.close()).toBe(0);
    expect(await session.close()).toBe(0);
  });

  it("handles signals and surfaces the exit code", async () => {
    const session = createSession("session-3");
    sessions.push(session);

    const exitEvents: number[] = [];
    session.on("exit", (code) => {
      exitEvents.push(code);
    });

    await session.waitFor("What is your name?");
    await session.signal("SIGINT");

    const code = await session.close();
    expect(code).toBe(130);
    expect(session.exitCode).toBe(130);
    expect(exitEvents).toContain(130);
  });

  it("fills text at once and rejects when waitFor times out", async () => {
    const session = createSession("session-4");
    sessions.push(session);

    await session.waitFor("What is your name?");
    await session.fill("Grace");
    await session.press("Enter");
    await session.waitFor("Hello, Grace!");

    await expect(session.waitFor("This will never appear", { timeout: 150 })).rejects.toThrow(
      /Timed out waiting for pattern/
    );
  });
});
