import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    ["R", 255], ["RGB", 255], ["A", 0], ["default", 0],
  ] as const)(`${mode} honors %s channels when optimizing transparency`, async (channel, alpha) => {
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    const args = ["xc:#1a3b52", "xc:#1a3b52",
      ...(channel === "default" ? [] : ["-channel", channel]),
      "-layers", "OptimizeTransparency", "+channel", "-depth", "8", "rgba:out.rgba"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.rgba") : files.get("out.rgba")!;
    expect([...bytes]).toEqual([26, 59, 82, 255, 26, 59, 82, alpha]);
  });
}
