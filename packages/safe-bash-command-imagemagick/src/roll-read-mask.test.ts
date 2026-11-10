import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI outputs for these exact PPM/PGM bytes.
const input = Buffer.concat([Buffer.from("P6\n4 2\n255\n"), Buffer.from(Array.from({ length: 24 }, (_, i) => i * 10))]);
const mask = Buffer.concat([Buffer.from("P5\n4 2\n255\n"), Buffer.from([0, 255, 255, 0, 255, 0, 0, 255])]);
const cases = [
    { name: "negative roll minimum", operations: ["-read-mask", "mask.pgm", "-roll", "-1+0", "-format", "%[fx:minima.r]"], output: "info:out", expected: "0.117647" },
    { name: "negative roll maximum", operations: ["-read-mask", "mask.pgm", "-roll", "-1+0", "-format", "%[fx:maxima.r]"], output: "info:out", expected: "0.823529" },
    { name: "positive roll minimum", operations: ["-read-mask", "mask.pgm", "-roll", "+1+0", "-format", "%[fx:minima.r]"], output: "info:out", expected: "0.117647" },
    { name: "mask applied after roll", operations: ["-roll", "-1+0", "-read-mask", "mask.pgm", "-format", "%[fx:minima.r]"], output: "info:out", expected: "0.235294" },
    { name: "whole-width roll", operations: ["-read-mask", "mask.pgm", "-roll", "+8+0", "-format", "%[fx:minima.r]"], output: "info:out", expected: "0.117647" },
    { name: "unmasked wrapped pixels", operations: ["-roll", "-5+3"], output: "PNG32:out", expected: "96a0aaffb4bec8ffd2dce6ff78828cff1e2832ff3c4650ff5a646eff000a14ff" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`matches native read-mask roll: $name, ${mode}`, async ({ operations, output, expected }) => {
        const files = new Map([["in.ppm", input], ["mask.pgm", mask], ["out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const args = ["in.ppm", ...operations, output];
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
        if (output === "info:out") expect(new TextDecoder().decode(bytes)).toBe(expected);
        else {
            const image = decodeImage(bytes);
            expect([image.width, image.height]).toEqual([4, 2]);
            expect(Buffer.from(image.data).toString("hex")).toBe(expected);
        }
    });
}
