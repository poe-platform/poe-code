import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI append mask regressions.
const mask = Buffer.concat([Buffer.from("P5\n2 3\n255\n"), Buffer.from([255, 0, 255, 0, 255, 0])]);
const cases = [
    { maskOption: "-read-mask", multiple: true, format: "%[fx:mean.r];", expected: "0;" },
    { maskOption: "-read-mask", multiple: true, format: "%[channels];", expected: "srgba 5.0;" },
    { maskOption: "-write-mask", multiple: true, format: "%[channels];", expected: "srgba 5.0;" },
    { maskOption: "", multiple: true, format: "%[fx:mean.r];", expected: "0.476078;" },
    { maskOption: "-read-mask", multiple: false, format: "%[channels];", expected: "srgba 5.0;" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`retains first-frame append masks: $maskOption $format multiple=$multiple, ${mode}`, async ({ maskOption, multiple, format, expected }) => {
        const files = new Map([["mask.pgm", mask], ["out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const args = ["(", "-size", "2x3", "xc:#8040c080", ...(maskOption ? [maskOption, "mask.pgm"] : []), ")",
            ...(multiple ? ["-size", "3x2", "xc:#30905040"] : []), "-append", "-format", format, "info:out"];
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

const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from(Array.from({ length: 18 }, (_, i) => (i * 13 + 7) % 256))]);

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const append of ["-append", "+append"]) {
        it.each(["none", "first", "second", "clear"])(`${append} matches native read-mask statistics for %s mask, ${mode}`, async (maskPosition) => {
            const files = new Map([["in.ppm", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.ppm", input);
            const args = ["(", "in.ppm", ...(maskPosition === "first" || maskPosition === "clear" ? ["-read-mask", "xc:white"] : []), ")",
                "(", "in.ppm", "-crop", "1x1+1+0", "+repage", ...(maskPosition === "second" ? ["-read-mask", "xc:white"] : []), ")",
                append, ...(maskPosition === "clear" ? ["+read-mask"] : []), "-format", "%[fx:mean.r]", "info:"];
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
            expect("stdout" in result ? result.stdout : stdout).toBe(maskPosition === "first" ? "0" : append === "-append" ? "0.515468" : "0.454902");
        });
    }
}
