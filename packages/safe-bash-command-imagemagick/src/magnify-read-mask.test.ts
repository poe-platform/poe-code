import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI statistics for the same 3x3 pixel art and mask.
const cases = [
    { name: "masked magnification", operations: ["-read-mask", "mask.pgm", "-magnify"], expected: "0" },
    { name: "masked input", operations: ["-read-mask", "mask.pgm"], expected: "0.535294" },
    { name: "mask removed after magnification", operations: ["-read-mask", "mask.pgm", "-magnify", "+read-mask"], expected: "0.621024" },
    { name: "unmasked magnification", operations: ["-magnify"], expected: "0.621024" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`matches native magnify read-mask statistics: $name, ${mode}`, async ({ operations, expected }) => {
        const colors = ["ef4020", "2266ee", "17df90"];
        const files = new Map([
            ["im.ppm", Buffer.concat([Buffer.from("P6\n3 3\n255\n"), Buffer.from([0, 1, 1, 0, 0, 1, 2, 0, 0].map(index => colors[index]).join(""), "hex")])],
            ["mask.pgm", Buffer.concat([Buffer.from("P5\n3 3\n255\n"), Buffer.from([0, 255, 0, 255, 0, 255, 0, 255, 0])])],
            ["out", Buffer.from("KEEP")],
        ]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const argv = ["im.ppm", ...operations, "-format", "%[fx:mean.r]", "info:out"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(Buffer.from(bytes).toString()).toBe(expected);
    });
}
