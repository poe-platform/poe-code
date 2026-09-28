import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { installIsolated } from "./install-isolated.mjs";

describe("isolated workspace installation", () => {
  it.each([false, true])("detaches a shared dependency symlink (dangling=%s) before npm runs", (dangling) => {
    const volume = Volume.fromJSON({ "/audit/artifact.txt": "keep", "/main/node_modules/marker": "keep" });
    volume.symlinkSync(dangling ? "/missing" : "/main/node_modules", "/audit/node_modules");
    const fs = createFsFromVolume(volume);
    const spawn = vi.fn(() => {
      expect(fs.existsSync("/audit/node_modules")).toBe(false);
      expect(fs.readFileSync("/main/node_modules/marker", "utf8")).toBe("keep");
      expect(fs.readFileSync("/audit/artifact.txt", "utf8")).toBe("keep");
      return { status: 0 };
    });
    expect(installIsolated({ root: "/audit", fs, spawn, npm: "/npm", args: ["--ignore-scripts"] })).toBe(0);
    expect(spawn).toHaveBeenCalledWith("/npm", ["ci", "--ignore-scripts"], { cwd: "/audit", stdio: "inherit", shell: false });
  });

  it.each([false, true])("accepts an independent or missing dependency directory (present=%s)", (present) => {
    const volume = Volume.fromJSON(present ? { "/audit/node_modules/marker": "keep" } : { "/audit/artifact": "keep" });
    const fs = createFsFromVolume(volume);
    const spawn = vi.fn(() => ({ status: 7 }));
    expect(installIsolated({ root: "/audit", fs, spawn, npm: "/npm" })).toBe(7);
    if (present) expect(fs.readFileSync("/audit/node_modules/marker", "utf8")).toBe("keep");
  });

  it("does not run npm when detaching fails", () => {
    const spawn = vi.fn();
    const fs = { lstatSync: () => ({ isSymbolicLink: () => true }), unlinkSync: () => { throw new Error("denied"); } };
    expect(() => installIsolated({ root: "/audit", fs, spawn })).toThrow("denied");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("reports a failure to start npm", () => {
    const fs = createFsFromVolume(Volume.fromJSON({ "/audit/artifact": "keep" }));
    expect(() => installIsolated({ root: "/audit", fs, spawn: () => ({ error: new Error("spawn failed") }) })).toThrow("spawn failed");
  });
});
