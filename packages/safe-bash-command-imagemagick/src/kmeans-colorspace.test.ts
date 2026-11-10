import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync, runMogrifyCli } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, seed 7, exported as 8-bit RGBA.
const cases = [
    { space: "HSL", colors: "1", expected: "00ff00ff00ff00ff00ff00ff" },
    { space: "Lab", colors: "1", expected: "bb7a73ffbb7a73ffbb7a73ff" },
    { space: "HSL", colors: "2", expected: "ffff00ffffff00ff0000ffff" },
    { space: "HSL", colors: undefined, expected: "ff0000ff00ff00ff0000ffff" },
    { space: "Lab", colors: undefined, expected: "ff0000ff00ff00ff0000ffff" },
    { space: "sRGB", colors: "1", expected: "555555ff555555ff555555ff" },
];

for (const mode of ["buffered", "sync", "retained", "command", "mogrify", "retained-mogrify"] as const)
it.each(cases)(`${mode}: clusters in $space with $colors colors`, async ({ space, colors, expected }) => {
    const files = new Map<string, Uint8Array>([["out", new TextEncoder().encode("KEEP")]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", files.get("out")!);
    const options = ["-colorspace", space, ...(colors ? ["-kmeans", colors] : []), "-colorspace", "sRGB", "-depth", "8"];
    const args = ["-seed", "7", "xc:red", "xc:lime", "xc:blue", "+append", ...options, "rgba:out"];
    const mogrify = mode === "mogrify" || mode === "retained-mogrify";
    if (mogrify) {
        // In-place processing uses the other k-means caller and starts with the same RGB strip.
        const input = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
        const png = await sharp(input, { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
        files.set("out.png", png);
        await fs.writeFile("/out.png", png);
    }
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mogrify ? await runMogrifyCli(["-seed", "7", ...options, "out.png"],
        mode === "mogrify" ? files : { filesystem: fs, cwd: "/" })
        : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
    const name = mogrify ? "out.png" : "out";
    const output = ["buffered", "sync", "mogrify"].includes(mode) ? files.get(name)! : await fs.readFile(`/${name}`);
    expect(Buffer.from(mogrify ? decodeImage(output).data : output).toString("hex")).toBe(expected);
});

for (const retained of [false, true])
it.each([
    ["HSL", "00ff00ff"],
    ["Lab", "bb7a73ff"],
])(`preserves working cluster means across raster chunks in %s (retained=${retained})`, async (space, expected) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const result = await runMagickCli(["-seed", "7", "-size", "343x1", "xc:red", "xc:lime", "xc:blue", "+append",
        "-colorspace", space, "-kmeans", "1", "-colorspace", "sRGB", "-depth", "8", "rgba:out"],
        retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = retained ? await fs.readFile("/out") : files.get("out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected.repeat(1029));
});
