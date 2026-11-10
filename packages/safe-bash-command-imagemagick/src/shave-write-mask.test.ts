import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference outputs, raw RGBA8.
const cases = [
    { name: "mask follows shaved pixels", operations: ["-write-mask", "m.pgm", "-shave", "1x1", "-negate", "+write-mask"], expected: "acc5deff08efd6ff" },
    { name: "mask attached after shave", operations: ["-shave", "1x1", "-write-mask", "m.pgm", "-negate", "+write-mask"], expected: "533a21ff08efd6ff" },
    { name: "mask cleared before negate", operations: ["-write-mask", "m.pgm", "-shave", "1x1", "+write-mask", "-negate"], expected: "533a21ff08efd6ff" },
    { name: "unmasked shave", operations: ["-shave", "1x1", "-negate"], expected: "533a21ff08efd6ff" },
];

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each(cases)(`preserves write-mask coordinates through shave: $name (${mode})`, async ({ operations, expected }) => {
        const files = new Map([
            ["in.ppm", Buffer.concat([Buffer.from("P6\n7 5\n255\n"), Buffer.from(Array.from({ length: 105 }, (_, i) => (25 * i + 9) % 256))])],
            ["m.pgm", Buffer.concat([Buffer.from("P5\n7 5\n255\n"), Buffer.from(Array.from({ length: 35 }, (_, i) => [9, 17, 22].includes(i) ? 255 : 0))])],
            ["out", Buffer.from("KEEP")],
        ]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile("/" + path, bytes);
        const args = ["in.ppm", ...operations, "-crop", "2x1+1+0", "+repage", "-depth", "8", "rgba:out"];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
