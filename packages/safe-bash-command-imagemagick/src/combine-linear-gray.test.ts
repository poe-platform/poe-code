import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, including alpha from a second intensity plane.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
for (const { inputs, options, expected } of [
    { inputs: ["xc:#12457890"], options: ["-colorspace", "LinearGray"], expected: "LinearGray|0.0574043" },
    { inputs: ["xc:#12457890"], options: ["-colorspace", "LinearGray", "-combine"], expected: "LinearGray|0.265735" },
    { inputs: ["xc:#12457890"], options: ["-colorspace", "Gray", "-set", "colorspace", "Gray", "-set", "gamma", "1", "-combine", "-colorspace", "sRGB", "-depth", "8"], expected: "3e3e3e90" },
    ...[
        { space: "LinearGray", count: 1, intensity: [], hex8: "8d8d8d90", hex16: "8d668d668d669090" },
        { space: "LinearGray", count: 2, intensity: [], hex8: "8d8d8d4f", hex16: "8d668d668d664fbf" },
        { space: "Gray", count: 1, intensity: [], hex8: "3e3e3e90", hex16: "3e143e143e149090" },
        { space: "Gray", count: 2, intensity: [], hex8: "3e3e3e4b", hex16: "3e143e143e144b79" },
        { space: "LinearGray", count: 2, intensity: ["-intensity", "Rec709Luminance"], hex8: "44444414", hex16: "440744074407143e" },
        { space: "LinearGray", count: 2, intensity: ["-intensity", "Average"], hex8: "44444414", hex16: "440744074407143e" }
    ].flatMap(({ space, count, intensity, hex8, hex16 }) => [8, 16].map(depth => ({
        inputs: ["xc:#12457890", "xc:#75432180"].slice(0, count),
        options: ["-colorspace", space, ...intensity, "-combine", "-colorspace", "sRGB", "-depth", String(depth), "-endian", "MSB"],
        expected: depth === 8 ? hex8 : hex16
    }))),
    { inputs: ["xc:black", "xc:black", "xc:black", "xc:white", "(", "xc:#12457890", "-colorspace", "LinearGray", ")"],
        options: ["-combine", "-channel", "meta0", "-separate", "-depth", "8"], expected: "444444ff" },
    { inputs: ["xc:#12457890"], options: ["-colorspace", "LinearGray", "+combine", "CMYK", "-colorspace", "sRGB", "-depth", "8"], expected: "bbf0f090" }
])
it(`${mode}: ${inputs.join(" ")} ${options.join(" ")}`, async () => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const info = expected.startsWith("LinearGray|");
    const args = [...inputs, ...options, ...(info ? ["-format", "%[colorspace]|%[fx:u.r]", "info:/out"] : ["rgba:/out"])];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString(info ? "utf8" : "hex")).toBe(expected);
});
