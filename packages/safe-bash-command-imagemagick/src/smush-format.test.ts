import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 keeps the first input's format before selecting an encoder.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "horizontal PPM first", inputs: ["in.ppm", "xc:red"], operation: ["+smush", "0"], expected: "PPM" },
        { name: "horizontal XC first", inputs: ["xc:red", "in.ppm"], operation: ["+smush", "0"], expected: "XC" },
        { name: "vertical PPM first", inputs: ["in.ppm", "xc:red"], operation: ["-smush", "1"], expected: "PPM" },
        { name: "vertical XC first", inputs: ["xc:red", "in.ppm"], operation: ["-smush", "1"], expected: "XC" },
        { name: "single PPM", inputs: ["in.ppm"], operation: ["-smush", "1"], expected: "PPM" },
        { name: "horizontal JPEG first", inputs: ["in.jpg", "xc:red"], operation: ["+smush", "0"], expected: "JPEG" },
        { name: "vertical JPEG first", inputs: ["in.jpg", "xc:red"], operation: ["-smush", "1"], expected: "JPEG" },
        { name: "unmodified PPM control", inputs: ["in.ppm"], operation: [], expected: "PPM" },
        { name: "append control", inputs: ["in.ppm", "xc:red"], operation: ["+append"], expected: "PPM" },
    ])(`${mode}: $name`, async ({ inputs, operation, expected }) => {
        const ppm = new Uint8Array([...new TextEncoder().encode("P6\n2 1\n255\n"), 10, 20, 30, 90, 110, 130]);
        const files = new Map([
            ["in.ppm", ppm],
            ["in.jpg", encodeImage(decodeImage(ppm), { format: "jpeg" }).data],
        ]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const argv = [...inputs, ...operation, "-format", "%m|%[magick]", "info:"];
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
        expect("stdout" in result ? result.stdout : stdout).toBe(`${expected}|${expected}`);
    });
}
