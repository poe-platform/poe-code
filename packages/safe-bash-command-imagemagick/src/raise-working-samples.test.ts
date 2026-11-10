import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes, including the unshaded controls.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const [scale, bevel, crop, expected] of [
    ["3", true, "1x1+3+2", [112, 64, 176, 128]],
    ["1", true, "1x1+3+2", [112, 64, 176, 128]],
    ["3", true, "1x1+0+0", [99, 74, 133, 108]],
    ["1", true, "1x1+0+0", [179, 154, 213, 188]],
    ["3", false, "1x1+3+2", [112, 64, 176, 128]]
] as const)
it(`preserves bevel working values: scale ${scale}, bevel ${bevel}, ${crop}, ${mode}`, async () => {
    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", files.get("/out")!);
    const args = ["-size", "8x6", "xc:#7040b080", "-evaluate", "Multiply", scale,
        ...(bevel ? ["-raise", "2x1"] : []), "-evaluate", "Divide", scale,
        "-crop", crop, "-depth", "8", "rgba:/out"];
    let stderr = "";
    const result = mode === "command" ? { ...await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }), stderr } : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(Array.from(output)).toEqual(expected);
});
