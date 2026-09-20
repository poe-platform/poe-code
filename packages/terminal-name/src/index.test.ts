import { execFile } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTerminalTabName } from "./index.js";

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

describe("terminal tab naming", () => {
  it("does nothing in unsupported terminals or for an empty name", async () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await setTerminalTabName("Plan");
    vi.stubEnv("TMUX", "tmux");
    vi.stubEnv("TMUX_PANE", "%42");
    await setTerminalTabName(" \u0007\n ");
    expect(execFile).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("ignores terminal write failures", async () => {
    vi.stubEnv("TERM_PROGRAM", "iTerm.app");
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    vi.spyOn(process.stdout, "write").mockImplementation(() => { throw new Error("terminal closed"); });
    await expect(setTerminalTabName("Plan")).resolves.toBeUndefined();
  });

  it("renames only the tmux window containing the original pane with a bounded command", async () => {
    vi.stubEnv("TMUX", "/tmp/tmux/default,1,0");
    vi.stubEnv("TMUX_PANE", "%42");
    await setTerminalTabName("Fix login");
    expect(execFile).toHaveBeenCalledWith("tmux", [
      "rename-window", "-t", "%42", "--", "Fix login"
    ], { timeout: 500 }, expect.any(Function));
  });

  it("ignores unavailable tmux and synchronous launch failures", async () => {
    vi.stubEnv("TMUX", "tmux");
    vi.stubEnv("TMUX_PANE", "%42");
    vi.mocked(execFile).mockImplementation(((_file, _args, _options, callback) => {
      callback(new Error("ENOENT"), "", "");
    }) as typeof execFile);
    await expect(setTerminalTabName("Plan")).resolves.toBeUndefined();
    vi.mocked(execFile).mockImplementation(() => { throw new Error("launch failed"); });
    await expect(setTerminalTabName("Plan")).resolves.toBeUndefined();
  });

  it("does not rename another pane when tmux has no pane identifier", async () => {
    vi.stubEnv("TMUX", "tmux");
    await setTerminalTabName("Plan");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("sets only an iTerm tab title and strips terminal control characters", async () => {
    vi.stubEnv("TERM_PROGRAM", "iTerm.app");
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await setTerminalTabName("Fix\u001b\u0007\n login\u009c");
    expect(write).toHaveBeenCalledWith("\u001b]1;Fix login\u0007");
  });

  it("keeps redirected iTerm output clean", async () => {
    vi.stubEnv("TERM_PROGRAM", "iTerm.app");
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await setTerminalTabName("Plan");
    expect(write).not.toHaveBeenCalled();
  });
});
