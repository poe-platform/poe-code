import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI outputs for these exact PPM/PGM bytes.
const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i * 7))]);
const mask = Buffer.concat([Buffer.from("P5\n4 3\n255\n"), Buffer.from("00ff00000000000000000000", "hex")]);
const cases = [
    { operations: ["-read-mask", "mask.pgm", "-flip"], expected: "4x3 0.0823529" },
    { operations: ["-read-mask", "mask.pgm", "-flop"], expected: "4x3 0.0823529" },
    { operations: ["-flip"], expected: "4x3 0.452941" },
    { operations: ["-read-mask", "mask.pgm", "-roll", "+2-1"], expected: "4x3 0.0823529" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`matches native read-mask mirroring: $operations, ${mode}`, async ({ operations, expected }) => {
        const files = new Map([["in.ppm", input], ["mask.pgm", mask], ["out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const args = ["in.ppm", ...operations, "-format", "%wx%h %[fx:mean.r]", "info:out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(new TextDecoder().decode(bytes)).toBe(expected);
    });
}
