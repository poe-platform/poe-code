import { fileURLToPath } from "node:url";
import { fs, vol } from "memfs";
import { expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => fs.promises);
const { realpath } = vi.hoisted(() => ({ realpath: vi.fn() }));
vi.mock("@poe-code/safe-fs/node", () => ({
  createHostFileSystem: () => ({ realpath })
}));

it.each([true, false])("uses safe-fs canonical paths to detect a symlinked CLI entry (direct=%s)", async direct => {
  vi.resetModules();
  vol.reset();
  realpath.mockReset().mockImplementation(async (path: string) =>
    path === "/bin/poe-safe-js" || direct ? "/canonical/cli.js" : path);
  const argv = process.argv;
  const exitCode = process.exitCode;
  const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  process.argv = [argv[0], "/bin/poe-safe-js", "--help"];
  try {
    await import("./cli.js");
    expect(realpath).toHaveBeenCalledWith("/bin/poe-safe-js");
    expect(realpath).toHaveBeenCalledWith(fileURLToPath(new URL("./cli.ts", import.meta.url)));
    if (direct) {
      expect(write).toHaveBeenCalledWith(expect.stringContaining("Usage: poe-safe-js"));
      expect(process.exitCode).toBe(0);
    } else {
      expect(write).not.toHaveBeenCalled();
    }
  } finally {
    process.argv = argv;
    process.exitCode = exitCode;
    write.mockRestore();
    vol.reset();
  }
});
