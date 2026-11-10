import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each(["PixelsPerCentimeter", "%[option:u]"])(`resolves units %s before reporting and encoding density (${mode})`, async units => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = ["xc:red", "-set", "option:u", "PixelsPerCentimeter", "-units", units,
      "-density", "100x50", "-write", "PNG24:/output.png", "-format", "%x/%y/%U", "info:-"];
    let stdout = "";
    const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
      args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
      stderr: { write: async () => {} } })
      : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    expect("stdout" in result ? result.stdout : stdout).toBe("100/50/PixelsPerCentimeter");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/output.png") : files.get("/output.png")!;
    const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
    const physical = [];
    for (let offset = 8; offset + 12 <= output.length; offset += view.getUint32(offset) + 12) {
      if (view.getUint32(offset + 4) === 0x70485973)
        physical.push([view.getUint32(offset + 8), view.getUint32(offset + 12), output[offset + 16]]);
    }
    expect(physical).toEqual([[10000, 5000, 1]]);
  });
}
