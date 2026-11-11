import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, with selection cleared before raw export.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const selectedPixels of [1, 513])
for (const selection of ["region", "write-mask", "none"] as const)
it.each([
    { space: "HSL", protectedPixel: "95af59" },
    { space: "Lab", protectedPixel: "5f8359" },
])(`${mode}: $space to sRGB with ${selection}, ${selectedPixels} selected pixels`, async ({ space, protectedPixel }) => {
    const input = Buffer.concat([Buffer.from(`P6\n${selectedPixels * 2} 1\n255\n`), Buffer.from("195693".repeat(selectedPixels) + "1c5996".repeat(selectedPixels), "hex")]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
    const argv = [
        ...(selection === "write-mask" ? ["(", "-size", `${selectedPixels * 2}x1`, "xc:white", "-fill", "black", "-draw", `rectangle 0,0 ${selectedPixels - 1},0`, "-write", "mpr:mask", "+delete", ")"] : []),
        "/in.ppm", "-colorspace", space,
        ...(selection === "region" ? ["-region", `${selectedPixels}x1+0+0`] : selection === "write-mask" ? ["-write-mask", "mpr:mask"] : []),
        "-colorspace", "sRGB",
        ...(selection === "region" ? ["+region"] : selection === "write-mask" ? ["+write-mask"] : []),
        "-depth", "8", "rgb:-",
    ];
    const argumentValues = createCommandArguments(argv);
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    expect(Buffer.from(output).toString("hex")).toBe("195693".repeat(selectedPixels) + (selection === "none" ? "1c5996" : protectedPixel).repeat(selectedPixels));
});
