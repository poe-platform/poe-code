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
    await opened;

    expect(spawnProcess).toHaveBeenCalledWith(
      "xdg-open",
      ["https://github.example.test/octo/repo/issues/1"],
      { detached: true, stdio: "ignore" }
    );
    expect(child.unref).toHaveBeenCalledOnce();
  });
});
