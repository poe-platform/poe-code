import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { openExternal } from "./browser.js";

describe("openExternal", () => {
  it("opens a url with the browser launcher", async () => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = vi.fn();
    const spawnProcess = vi.fn(() => child);
    const opened = openExternal("https://github.example.test/octo/repo/issues/1", {
      platform: "linux",
      spawnProcess
    });

    child.emit("spawn");
    child.emit("close", 0, null);
    await opened;

    expect(spawnProcess).toHaveBeenCalledWith(
      "xdg-open",
      ["https://github.example.test/octo/repo/issues/1"],
      { detached: true, stdio: "ignore" }
    );
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("opens Windows urls without passing them through cmd.exe", async () => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = vi.fn();
    const spawnProcess = vi.fn(() => child);
    const url = "https://github.example.test/octo/repo/issues/1?x=1&name=%25PATH%25|calc";
    const opened = openExternal(url, {
      platform: "win32",
      spawnProcess
    });

    child.emit("spawn");
    child.emit("close", 0, null);
    await opened;

    expect(spawnProcess).toHaveBeenCalledWith(
      "rundll32.exe",
      ["url.dll,FileProtocolHandler", url],
      { detached: true, stdio: "ignore" }
    );
  });

  it("rejects when the browser launcher exits unsuccessfully", async () => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = vi.fn();
    const opened = openExternal("https://github.example.test/octo/repo/issues/1", {
      platform: "linux",
      spawnProcess: vi.fn(() => child)
    });

    child.emit("spawn");
    child.emit("close", 1, null);

    await expect(opened).rejects.toThrow("Browser launcher exited with code 1");
  });
});
