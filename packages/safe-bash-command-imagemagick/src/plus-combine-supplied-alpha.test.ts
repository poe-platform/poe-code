import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: the fourth plane contributes intensity, not alpha.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
for (const alpha of [true, false])
it.each([
    { colorspace: "RGB", rgb: "3e4b92" },
    { colorspace: "Lab", rgb: "005739" },
    { colorspace: "HSI", rgb: "94bb67" },
    { colorspace: "sRGB", rgb: "3e4b92" },
])(`${mode}: +combine $colorspace uses the supplied alpha plane (base alpha=${alpha})`, async ({ colorspace, rgb }) => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const args = [`xc:#124578${alpha ? "90" : ""}`, "xc:#75432180", "xc:#22bb4499", "xc:#ddeeff88",
        "+combine", colorspace, "-depth", "8", "rgba:/out"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(`${rgb}${alpha || colorspace === "sRGB" ? "ec" : "ff"}`);
});
