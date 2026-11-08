import { EventEmitter } from "node:events";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("screenshot dependency bootstrap", () => {
  let rendererReady: boolean;
  let prepareCode: number;
  let prepareBuildsRenderer: boolean;
  let events: string[];
  const render = vi.fn();
  const spawn = vi.fn();
  const launch = vi.fn();
  const closeSession = vi.fn();
  const closePilot = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    rendererReady = false;
    prepareCode = 0;
    prepareBuildsRenderer = true;
    events = [];
    vi.stubEnv("POE_SCREENSHOT_PTY", "0");
    vi.stubEnv("POE_SCREENSHOT_KEYS", "");
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.doMock("node:fs", () => ({ mkdirSync: vi.fn() }));
    vi.doMock("node:child_process", () => ({ spawn }));
    vi.doMock("terminal-png", () => {
      events.push("load renderer");
      if (!rendererReady) {
        throw new Error("terminal-png has not been built");
      }
      return { renderTerminalPng: render };
    });
    vi.doMock("terminal-pilot", () => ({ TerminalPilot: { launch } }));
    render.mockImplementation(async () => {
      events.push("render");
    });
    launch.mockImplementation(async () => {
      events.push("launch pilot");
      return {
        newSession: vi.fn(async () => ({
          waitForExit: vi.fn(async () => 0),
          screen: vi.fn(async () => ({ rawLines: ["ready"] })),
          close: closeSession
        })),
        close: closePilot
      };
    });
    spawn.mockImplementation((_command: string, args: string[]) => {
      const preparing = args.includes("predev");
      events.push(preparing ? "start prepare" : "start command");
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        killed: false,
        kill: vi.fn()
      });
      queueMicrotask(() => {
        if (preparing) {
          rendererReady = prepareCode === 0 && prepareBuildsRenderer;
          events.push("finish prepare");
        } else {
          child.stdout.emit("data", Buffer.from("ready\n"));
        }
        child.emit("close", preparing ? prepareCode : 0);
      });
      return child;
    });
  });

  afterEach(() => {
    vi.doUnmock("terminal-png");
    vi.doUnmock("terminal-pilot");
    vi.doUnmock("node:child_process");
    vi.doUnmock("node:fs");
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("loads target utilities without loading an unbuilt renderer", async () => {
    const { resolveScreenshotTarget } = await import("./screenshot.js");

    expect(resolveScreenshotTarget(["--poe-code", "--help"]).prepare).toEqual({
      command: "npm",
      args: ["run", "--silent", "predev"]
    });
    expect(events).toEqual([]);
  });

  describe.each(["transcript", "pty"] as const)("%s capture", (capture) => {
    beforeEach(() => {
      vi.stubEnv("POE_SCREENSHOT_PTY", capture === "pty" ? "1" : "0");
    });

    it("loads the renderer only after successful preparation", async () => {
      const { runScreenshot } = await import("./screenshot.js");

      await runScreenshot(["--poe-code", "--help"], { output: "screenshots/help.png" });

      expect(events).toEqual([
        "start prepare",
        "finish prepare",
        "load renderer",
        capture === "pty" ? "launch pilot" : "start command",
        "render"
      ]);
      expect(render).toHaveBeenCalledWith(expect.stringContaining("ready"), {
        output: "screenshots/help.png",
        padding: 20,
        window: true
      });
      expect(closeSession).toHaveBeenCalledTimes(capture === "pty" ? 1 : 0);
      expect(closePilot).toHaveBeenCalledTimes(capture === "pty" ? 1 : 0);
    });

    it("preserves a failed preparation without loading capture dependencies", async () => {
      prepareCode = 2;
      const { runScreenshot } = await import("./screenshot.js");

      await expect(runScreenshot(["--poe-code", "--help"], {}))
        .rejects.toThrow("npm run --silent predev exited with code 2");

      expect(events).toEqual(["start prepare", "finish prepare"]);
      expect(launch).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
    });

    it("does not start capture when preparation leaves the renderer unavailable", async () => {
      prepareBuildsRenderer = false;
      const { runScreenshot } = await import("./screenshot.js");

      await expect(runScreenshot(["--poe-code", "--help"], {})).rejects.toThrow();

      expect(events).toEqual(["start prepare", "finish prepare", "load renderer"]);
      expect(launch).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
    });

    it("does not start a generic command when its renderer is unavailable", async () => {
      const { runScreenshot } = await import("./screenshot.js");

      await expect(runScreenshot(["echo", "ready"], {})).rejects.toThrow();

      expect(events).toEqual(["load renderer"]);
      expect(spawn).not.toHaveBeenCalled();
      expect(launch).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
    });

    it("captures a generic command with an available renderer without preparation", async () => {
      rendererReady = true;
      const { runScreenshot } = await import("./screenshot.js");

      await runScreenshot(["echo", "ready"], { output: "screenshots/ready.png" });

      expect(events).toEqual([
        "load renderer",
        capture === "pty" ? "launch pilot" : "start command",
        "render"
      ]);
    });
  });
});
