import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI outputs for these exact PPM/PGM bytes.
const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i * 7))]);
const mask = Buffer.concat([Buffer.from("P5\n4 3\n255\n"), Buffer.from("00ff00000000000000000000", "hex")]);
const cases = [
    { name: "same-size extent", operations: ["-read-mask", "mask.pgm", "-extent", "4x3"], expected: "4x3 0" },
    { name: "skipped extent", operations: ["-read-mask", "mask.pgm", "-extent", "3x2<"], expected: "4x3 0" },
    { name: "empty overlap", operations: ["-read-mask", "mask.pgm", "-extent", "5x4+10+0"], expected: "5x4 0" },
    { name: "copy composition", operations: ["-read-mask", "mask.pgm", "-compose", "Copy", "-extent", "5x4+1+0"], expected: "5x4 0" },
    { name: "HDRI extent", operations: ["-read-mask", "mask.pgm", "-evaluate", "Add", "10%", "-extent", "5x4+1+0"], expected: "5x4 0" },
    { name: "replaced mask", operations: ["-read-mask", "mask.pgm", "-extent", "5x4+1+0", "-read-mask", "mask.pgm"], expected: "5x4 0.164706" },
    { name: "masked extent", operations: ["-read-mask", "mask.pgm", "-extent", "5x4+1+0"], expected: "5x4 0" },
    { name: "mask without extent", operations: ["-read-mask", "mask.pgm"], expected: "4x3 0.0823529" },
    { name: "extent without mask", operations: ["-extent", "5x4+1+0"], expected: "5x4 0.772353" },
    { name: "mask removed after extent", operations: ["-read-mask", "mask.pgm", "-extent", "5x4+1+0", "+read-mask"], rgb: true,
        expected: "151c232a31383f464dffffffffffff6970777e858c939aa1ffffffffffffbdc4cbd2d9e0e7eef5ffffffffffffffffffffffffffffffffffffffffff" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`matches native read-mask extent: $name, ${mode}`, async ({ operations, expected, rgb }) => {
        const files = new Map([["in.ppm", input], ["mask.pgm", mask], ["out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const args = ["in.ppm", ...operations, ...(rgb ? ["-depth", "8", "rgb:out"] : ["-format", "%wx%h %[fx:mean.r]", "info:out"])];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(rgb ? Buffer.from(bytes).toString("hex") : new TextDecoder().decode(bytes)).toBe(expected);
    });
}
