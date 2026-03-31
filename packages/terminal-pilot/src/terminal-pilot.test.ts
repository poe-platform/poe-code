import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { TerminalPilot } from "./terminal-pilot.js";

const testingDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "testing");
const testCliPath = path.join(testingDirectory, "test-cli.ts");
const tsxPath = path.join(process.cwd(), "node_modules", ".bin", "tsx");

function createSessionOptions() {
  return {
    command: tsxPath,
    args: [testCliPath],
    cwd: process.cwd(),
    observe: false
  };
}

describe("TerminalPilot", () => {
  const pilots: TerminalPilot[] = [];

  afterEach(async () => {
    await Promise.all(
      pilots.map(async (pilot) => {
        try {
          await pilot.close();
        } catch {
          // noop
        }
      })
    );
    pilots.length = 0;
  });

  it("creates multiple sessions, lists them, gets them by id, and closes all sessions", async () => {
    const pilot = await TerminalPilot.launch();
    pilots.push(pilot);

    const first = await pilot.newSession({
      ...createSessionOptions(),
      cols: 80,
      rows: 24
    });
    const second = await pilot.newSession({
      ...createSessionOptions(),
      cols: 100,
      rows: 30
    });

    expect(first.id).not.toBe(second.id);

    await Promise.all([first.waitFor("What is your name?"), second.waitFor("What is your name?")]);
    await Promise.all([first.send("Ada\r"), second.send("Grace\r")]);
    await Promise.all([first.waitFor("Hello, Ada!"), second.waitFor("Hello, Grace!")]);

    expect(pilot.sessions()).toEqual([first, second]);
    expect(pilot.getSession(first.id)).toBe(first);
    expect(pilot.getSession(second.id)).toBe(second);
    expect(() => pilot.getSession("missing-session")).toThrowError(
      "Session not found: missing-session"
    );

    await pilot.close();

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(pilot.sessions()).toEqual([]);
    expect(() => pilot.getSession(first.id)).toThrowError(`Session not found: ${first.id}`);
  });

  it("uses default session sizing and keeps sessions() isolated from caller mutations", async () => {
    const pilot = await TerminalPilot.launch();
    pilots.push(pilot);

    const session = await pilot.newSession(createSessionOptions());

    await session.waitFor("What is your name?");

    const listedSessions = pilot.sessions();
    listedSessions.length = 0;

    expect(pilot.sessions()).toEqual([session]);

    const screen = await session.screen();
    expect(screen.size).toEqual({ cols: 120, rows: 40 });
  });

  it("cleans up every tracked session even when some sessions were already closed", async () => {
    const pilot = await TerminalPilot.launch();
    pilots.push(pilot);

    const first = await pilot.newSession(createSessionOptions());
    const second = await pilot.newSession(createSessionOptions());

    await Promise.all([first.waitFor("What is your name?"), second.waitFor("What is your name?")]);
    await first.send("Ada\r");
    await second.send("Grace\r");
    await Promise.all([first.waitFor("Hello, Ada!"), second.waitFor("Hello, Grace!")]);

    expect(await first.close()).toBe(0);

    await expect(pilot.close()).resolves.toBeUndefined();
    await expect(pilot.close()).resolves.toBeUndefined();

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(pilot.sessions()).toEqual([]);
  });
});
