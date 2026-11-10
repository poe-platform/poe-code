import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const inputs = [["a", 4, 3], ["b", 3, 5]] as const;
const fixtures = inputs.map(([name, width, height]) => {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            data.set([20 + 45 * x, 15 + 40 * y, name === "a" ? 100 : 180,
                (x + y) % 4 === 0 ? 0 : x === 1 ? 100 : 255], (y * width + x) * 4);
        }
    }
    return [`/${name}.png`, encodeImage({ width, height, data, format: "png", space: "srgb",
        channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data] as const;
});

// ImageMagick 7.1.2-35: input escapes describe the first image, %w/%h the output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { args: ["/a.png", "/b.png", "+smush", "0"], expected: "a.png|a|png|4x3|7x5" },
        { args: ["/a.png", "/b.png", "-smush", "1"], expected: "a.png|a|png|4x3|4x9" },
        { args: ["/b.png", "/a.png", "+smush", "0"], expected: "b.png|b|png|3x5|7x5" },
        { args: ["/b.png", "/a.png", "-smush", "1"], expected: "b.png|b|png|3x5|4x9" },
        { args: ["/a.png", "+smush", "0"], expected: "a.png|a|png|4x3|4x3" },
        { args: ["/a.png", "-smush", "1"], expected: "a.png|a|png|4x3|4x3" },
        { args: ["/a.png"], expected: "a.png|a|png|4x3|4x3" },
        { args: ["/a.png", "/b.png", "+append"], expected: "a.png|a|png|4x3|7x5" },
    ])(`${mode}: retains first input format escapes for $args`, async ({ args, expected }) => {
        const files = new Map(fixtures);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["-quiet", ...args, "-format", "%f|%t|%e|%G|%wx%h", "info:"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
