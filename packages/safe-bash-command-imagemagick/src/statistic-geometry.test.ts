import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35: Maximum 3x3 on this 7x5 grayscale image.
const input = Uint8Array.from([
    ...new TextEncoder().encode("P5\n7 5\n255\n"),
    22, 82, 156, 5, 107, 223, 114,
    19, 177, 110, 57, 18, 232, 221,
    224, 2, 33, 78, 137, 210, 58,
    159, 35, 164, 68, 225, 157, 103,
    63, 37, 25, 27, 43, 73, 117,
]);
const expected = [
    177, 177, 177, 156, 232, 232, 232,
    224, 224, 177, 156, 232, 232, 232,
    224, 224, 177, 225, 232, 232, 232,
    224, 224, 164, 225, 225, 225, 210,
    159, 164, 164, 225, 225, 225, 157,
];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["x3", "bad", "3x3"])(`${mode}: validates statistic geometry %s before replacing output`, async geometry => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/input.pgm", input], ["/out.pgm", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.pgm", input);
        await fs.writeFile("/out.pgm", keep);
        const args = ["/input.pgm", "-statistic", "Maximum", geometry, "/out.pgm"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const output = mode === "buffered" || mode === "sync" ? files.get("/out.pgm")! : await fs.readFile("/out.pgm");
        stderr = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
        if (geometry === "3x3") {
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const decoded = decodeImage(output);
            expect([decoded.width, decoded.height]).toEqual([7, 5]);
            expect([...decoded.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
        } else {
            expect(output).toEqual(keep);
            expect(result.exitCode).toBe(1);
            expect(stderr).toContain("invalid argument for option '-statistic'");
            expect(stderr).toContain(geometry);
        }
    });
}
