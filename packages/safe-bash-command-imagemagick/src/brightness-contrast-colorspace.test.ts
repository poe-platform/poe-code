import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw RGB8 output after converting back to sRGB.
const cases = [
    { space: "HSL", options: ["-brightness-contrast", "10x30"], expected: "6f00c9852fffdfef73" },
    { space: "Lab", options: ["-brightness-contrast", "10x30"], expected: "964086deb2ffffff00" },
    { space: "sRGB", options: ["-brightness-contrast", "10x30"], expected: "0360bd06c7ffffff4b" },
    { space: "HSL", options: [], expected: "0f50911198e7c3d041" },
    { space: "Lab", options: [], expected: "0f50911198e7c3d041" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: preserves $space $options through sRGB conversion`, async ({ space, options, expected }) => {
        const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["a.ppm", input], ["out", sentinel]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/a.ppm", input);
        await fs.writeFile("/out", sentinel);
        const argv = ["a.ppm", "-colorspace", space, ...options, "-colorspace", "sRGB", "-endian", "MSB", "-depth", "8", "rgb:out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
