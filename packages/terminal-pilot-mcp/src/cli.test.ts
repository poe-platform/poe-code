import { beforeEach, expect, it, vi } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fs, vol } from "memfs";
vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  realpathSync: (await import("memfs")).fs.realpathSync
}));
const { listen } = vi.hoisted(() => ({ listen: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./index.js", () => ({ main: listen }));
beforeEach(() => { vi.clearAllMocks(); vol.reset(); });
it.each([false, true])("runs stdio when invoked as an executable: symlink=%s", async (symlink) => {
  const target = fileURLToPath(new URL("./cli.ts", import.meta.url));
  const alias = "/bin/terminal-pilot-mcp";
  fs.mkdirSync(dirname(target), { recursive: true });
  fs.writeFileSync(target, "");
  fs.mkdirSync("/bin", { recursive: true });
  fs.symlinkSync(target, alias);
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  try {
    process.argv = [process.execPath, symlink ? alias : target];
    vi.resetModules();
    await import("./cli.js");
    expect(listen).toHaveBeenCalledOnce();
  } finally {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
  }
});
it("prints help without opening the MCP transport", async () => {
  const { runCli } = await import("./cli.js");
  const write = vi.fn();
  expect(await runCli(["--help"], { write })).toBe(0);
  expect(write).toHaveBeenCalledWith(expect.stringContaining("Usage: terminal-pilot-mcp"));
  expect(listen).not.toHaveBeenCalled();
});
it("rejects unknown options without opening the transport", async () => {
  const { runCli } = await import("./cli.js");
  const write = vi.fn();
  expect(await runCli(["--http"], { write })).toBe(1);
  expect(write).toHaveBeenCalledWith(expect.stringContaining("--help"));
  expect(listen).not.toHaveBeenCalled();
});
it("starts stdio without writing non-protocol output", async () => {
  const { runCli } = await import("./cli.js");
  const write = vi.fn();
  expect(await runCli([], { write })).toBe(0);
  expect(listen).toHaveBeenCalledOnce();
  expect(write).not.toHaveBeenCalled();
});
