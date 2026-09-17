import { execFile } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePlan } from "../plan/parser.js";
import { setPipelineTerminalName } from "./terminal-name.js";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

beforeEach(() => {
  vi.stubEnv("TMUX", "");
  vi.stubEnv("TMUX_PANE", "");
  vi.stubEnv("TERM_PROGRAM", "");
  vi.mocked(execFile).mockImplementation(((_file, _args, _options, callback) => {
    callback(null, "", "");
  }) as typeof execFile);
});

afterEach(() => {
  if (ttyDescriptor) Object.defineProperty(process.stdout, "isTTY", ttyDescriptor);
  else delete process.stdout.isTTY;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("pipeline terminal naming", () => {
  it("preserves the existing plan name metadata", () => {
    expect(parsePlan("kind: pipeline\nversion: 1\nname: Fix login\ntasks: []").name).toBe("Fix login");
  });

  it("targets the original tmux pane and its window with a bounded command", async () => {
    vi.stubEnv("TMUX", "/tmp/tmux/default,1,0");
    vi.stubEnv("TMUX_PANE", "%42");
    await setPipelineTerminalName("Fix login");
    expect(execFile).toHaveBeenCalledWith("tmux", [
      "rename-window", "-t", "%42", "--", "Fix login", ";",
      "select-pane", "-t", "%42", "-T", "Fix login"
    ], { timeout: 500 }, expect.any(Function));
  });

  it("ignores unavailable tmux and synchronous launch failures", async () => {
    vi.stubEnv("TMUX", "tmux");
    vi.stubEnv("TMUX_PANE", "%42");
    vi.mocked(execFile).mockImplementation(((_file, _args, _options, callback) => {
      callback(new Error("ENOENT"), "", "");
    }) as typeof execFile);
    await expect(setPipelineTerminalName("Plan")).resolves.toBeUndefined();
    vi.mocked(execFile).mockImplementation(() => { throw new Error("launch failed"); });
    await expect(setPipelineTerminalName("Plan")).resolves.toBeUndefined();
  });

  it("does not rename another pane when tmux has no pane identifier", async () => {
    vi.stubEnv("TMUX", "tmux");
    await setPipelineTerminalName("Plan");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("sets an iTerm title and strips terminal control characters", async () => {
    vi.stubEnv("TERM_PROGRAM", "iTerm.app");
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await setPipelineTerminalName("Fix\u001b\u0007\n login\u009c");
    expect(write).toHaveBeenCalledWith("\u001b]0;Fix login\u0007");
  });

  it("keeps redirected iTerm output clean", async () => {
    vi.stubEnv("TERM_PROGRAM", "iTerm.app");
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await setPipelineTerminalName("Plan");
    expect(write).not.toHaveBeenCalled();
  });
});
