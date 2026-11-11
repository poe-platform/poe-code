import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const inputs = ["xc:#12457890", "xc:#75432180", "xc:#22bb4499", "xc:#80808060", "xc:#40404070"];
// ImageMagick 7.1.2-35 Q16-HDRI: missing alpha planes retain the first image's alpha.
const cases = [
    { colorspace: "sRGB", count: 1, channels: "srgba 4.0", rgba: "3e457890" },
    { colorspace: "sRGB", count: 3, channels: "srgba 4.0", rgba: "3e4b9290" },
    { colorspace: "sRGB", count: 4, channels: "srgba 4.0", rgba: "3e4b9280" },
    { colorspace: "Gray", count: 1, channels: "graya 2.0", rgba: "3e3e3e90" },
    { colorspace: "Gray", count: 2, channels: "graya 2.0", rgba: "3e3e3e4b" },
    { colorspace: "CMYK", count: 4, channels: "cmyka 5.0", rgba: "605a3690" },
    { colorspace: "CMYK", count: 5, channels: "cmyka 5.0", rgba: "605a3640" },
];

for (const mode of ["command", "buffered", "sync", "retained"] as const)
for (const output of ["info", "rgba"] as const)
it.each(cases)(`${mode}: +combine $colorspace with $count planes preserves or replaces alpha (${output})`, async ({ colorspace, count, channels, rgba }) => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const args = [...inputs.slice(0, count), "+combine", colorspace,
        ...(output === "info" ? ["-format", "%[channels]|%[opaque]", "info:/out"]
            : ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"])];
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
    expect(Buffer.from(bytes).toString(output === "info" ? "utf8" : "hex"))
        .toBe(output === "info" ? `${channels}|False` : rgba);
});
