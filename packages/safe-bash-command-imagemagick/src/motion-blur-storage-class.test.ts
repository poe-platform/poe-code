import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P6\n5 3\n255\n"),
    Buffer.from(Array.from({ length: 15 }, (_, i) => [i * 17, (i * 47) % 256, 200 - i * 7]).flat()),
]);
const alpha = ["-alpha", "set", "-channel", "A", "-evaluate", "Set", "50%", "+channel"];

// ImageMagick 7.1.2-35 Q16-HDRI promotes palettes even for zero sigma.
for (const mode of ["magick", "convert", "buffered", "retained", "sync"] as const)
it.each([
    { operations: [], expected: "DirectClass sRGB |srgb  3.0" },
    { operations: ["-colors", "16"], expected: "PseudoClass sRGB |srgb  4.0" },
    { operations: ["-colors", "16", "-motion-blur", "2x1+0"], expected: "DirectClass sRGB |srgb  3.0" },
    { operations: ["-colors", "16", "-motion-blur", "2x0+0"], expected: "DirectClass sRGB |srgb  3.0" },
    { operations: ["-colors", "16", "-channel", "R", "-motion-blur", "2x1+0"], expected: "DirectClass sRGB |srgb  3.0" },
    { operations: [...alpha, "-colors", "16"], expected: "PseudoClass sRGB Alpha|srgba 5.0" },
    { operations: [...alpha, "-colors", "16", "-motion-blur", "2x1+0"], expected: "DirectClass sRGB Alpha|srgba 4.0" },
])(`reports native motion blur storage and channels for $operations (${mode})`, async ({ operations, expected }) => {
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const args = ["/in.ppm", ...operations, "-format", "%r|%[channels]", "info:"];
    let stdout = "", stderr = "";
    const result = mode === "magick" || mode === "convert" ? await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
        command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect("stdout" in result ? result.stdout : stdout).toBe(expected);
});
