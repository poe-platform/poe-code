import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCliSync, runMogrifyCli } from "./index.js";

const input = new TextEncoder().encode("P3\n2 1\n255\n255 0 0 0 0 255\n");

// Expected text verified with ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["buffered", "magick", "convert"] as const) {
    it.each([
        { name: "expands the caption on canvas reads", args: ["-caption", "cap-%w", "xc:red"], expected: "[cap-1]" },
        { name: "expands the caption on file reads", args: ["-caption", "cap-%wx%h", "input.ppm"], expected: "[cap-2x1]" },
        { name: "expands the caption on saved image reads", args: ["xc:red", "xc:blue", "+append", "-write", "mpr:a", "+delete", "-caption", "hello-%w", "mpr:a"], expected: "[hello-2]" },
        { name: "expands independently for each input", args: ["-caption", "cap-%w", "xc:red", "input.ppm"], expected: "[cap-1][cap-2]" },
        { name: "changes only subsequent input captions", args: ["-caption", "old", "xc:red", "-caption", "new", "xc:blue"], expected: "[old][new]" },
        { name: "resets the pending caption", args: ["-caption", "old-%w", "xc:red", "+caption", "xc:blue"], expected: "[old-1][]" },
        { name: "preserves saved captions after resetting", args: ["-caption", "old", "xc:red", "-write", "mpr:a", "+delete", "-caption", "new-%w", "mpr:a", "+caption", "mpr:a"], expected: "[new-1][old]" },
        { name: "accepts an empty caption", args: ["-caption", "", "xc:red"], expected: "[]" },
        { name: "retains set caption behavior", args: ["xc:red", "-set", "caption", "hello-%w"], expected: "[hello-1]" },
        { name: "falls back to the pending caption", args: ["xc:red", "-caption", "late"], expected: "[late]" },
        { name: "does not attach a trailing setting to existing images", args: ["xc:red", "-caption", "late", "-write", "mpr:a", "+delete", "+caption", "mpr:a"], expected: "[]" },
        { name: "exposes the unexpanded caption option", args: ["-caption", "cap-%w", "xc:red", "-set", "caption", "%[option:caption]"], expected: "[cap-%w]" },
    ])(`${mode}: $name`, async ({ args, expected }) => {
        const files = new Map([["input.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.ppm", input);
        const argv = ["-quiet", ...args, "-format", "[%[caption]]", "info:"];
        let stdout = "", stderr = "";
        const result = mode === "buffered" ? runMagickCliSync(argv, files) : {
            ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode, args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr
        };
        expect(result).toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
    });
}

for (const retained of [false, true]) {
    it.each([
        { options: ["-caption", "cap-%w"], expected: "[cap-2]" },
        { options: ["-caption", "cap-%w", "+caption"], expected: "[]" }
    ])(`mogrify (retained=${retained}): $options`, async ({ options, expected }) => {
        const files = new Map([["input.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.ppm", input);
        expect(await runMogrifyCli(["-format", "png", ...options, "input.ppm"], retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0, stderr: "" });
        const output = retained ? await fs.readFile("/input.png") : files.get("input.png")!;
        expect(runMagickCliSync(["-quiet", "input.png", "-format", "[%[caption]]", "info:"], new Map([["input.png", output]])))
            .toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
