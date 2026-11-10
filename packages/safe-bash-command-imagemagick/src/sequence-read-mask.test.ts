import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI statistics for both read-mask placements.
const operators = [
    { operation: "Max", mean: "0.562745" },
    { operation: "Min", mean: "0.24902" },
    { operation: "Median", mean: "0.562745" },
    { operation: "Sum", mean: "0.811765" },
    { operation: "Mean", mean: "0.405882" },
];
const cases = operators.flatMap(({ operation, mean }) => [
    { operation, placement: "first", clear: false, expected: "0" },
    { operation, placement: "second", clear: false, expected: "0" },
    { operation, placement: "first", clear: true, expected: mean },
    { operation, placement: "second", clear: true, expected: mean },
    { operation, placement: "none", clear: false, expected: mean },
]);

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`matches native $operation with $placement read mask (clear=$clear), ${mode}`, async ({ operation, placement, clear, expected }) => {
        const files = new Map([
            ["a.ppm", Buffer.from("P3\n2 1\n255\n13 30 79 235 153 61\n")],
            ["c.ppm", Buffer.from("P3\n2 1\n255\n52 73 91 114 137 180\n")],
            ["mask.pgm", Buffer.from("P2\n2 1\n255\n255 0\n")],
            ["out", Buffer.from("KEEP")],
        ]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const argv = ["(", "a.ppm", ...(placement === "first" ? ["-read-mask", "mask.pgm"] : []), ")",
            "(", "c.ppm", ...(placement === "second" ? ["-read-mask", "mask.pgm"] : []), ")",
            "-evaluate-sequence", operation, ...(clear ? ["+read-mask"] : []), "-format", "%[fx:mean.r]", "info:out"];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(Buffer.from(bytes).toString("utf8")).toBe(expected);
    });
}
