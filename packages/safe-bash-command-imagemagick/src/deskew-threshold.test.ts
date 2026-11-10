import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

const input = new Uint8Array(readFileSync(new URL("./fixtures/deskew-threshold.png", import.meta.url)));

for (const mode of ["buffered", "retained", "sync", "command", "mogrify", "retained-mogrify"] as const) {
    it.each(["0b1", "0o10", "40junk", "bogus", "x40junk", "(bogus)", "e40", "e", ",", "()", "+", "NaN", "Infinity", "", " "])(`rejects invalid deskew threshold %j without replacing output (${mode})`, async threshold => {
        const mogrify = mode.endsWith("mogrify");
        const original = mogrify ? input : new TextEncoder().encode("KEEP");
        const destination = mogrify ? "/input.png" : "/output.png";
        const files = new Map([["/input.png", input], [destination, original]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(name, bytes);
        const args = mogrify ? ["-deskew", threshold, "/input.png"] : ["/input.png", "-deskew", threshold, "PNG32:/output.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await (mogrify ? runMogrifyCli : runConvertCli)(args, mode.startsWith("retained") ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(1);
        expect(mode === "command" || mode.startsWith("retained") ? await fs.readFile(destination) : files.get(destination)).toEqual(original);
    });

    // Native ImageMagick validates geometry but applies % only immediately after the first number.
    it.each([["x40%", "0"], [",40%", "0"], ["(40%)", "0"], ["x", "0"], ["%", "0"], ["-", "0"], [".", "0"], ["40x2%", "40"], ["40%x2", "40%"], ["4e1x2%", "40"], ["40+2%", "40"], ["40 %", "40"], ["+40%", "40%"], ["0x6666", "26214"], ["+0x28%", "40%"], ["40%", "26214"], ["0", "0"]])(`reads deskew threshold %s as %s (${mode})`, async (threshold, scalar) => {
        const files = new Map([["/input.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const mogrify = mode.endsWith("mogrify");
        const args = mogrify ? ["-deskew", threshold, "/input.png"] : ["/input.png", "-deskew", threshold, "PNG32:/output.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await (mogrify ? runMogrifyCli : runConvertCli)(args, mode.startsWith("retained") ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        const destination = mogrify ? "/input.png" : "/output.png";
        const actual = decodeImage(mode === "command" || mode.startsWith("retained") ? await fs.readFile(destination) : files.get(destination)!);
        const reference = runConvertCliSync(["/input.png", "-deskew", scalar, "PNG32:-"], new Map([["/input.png", input]]));
        expect(reference.exitCode, reference.stderr).toBe(0);
        const expected = decodeImage(reference.stdoutBytes!);
        expect([actual.width, actual.height, actual.data]).toEqual([expected.width, expected.height, expected.data]);
    });
}

it("distinguishes absolute and percentage deskew thresholds in the regression fixture", () => {
    const outputs = ["40", "40%"].map(threshold => {
        const result = runConvertCliSync(["/input.png", "-deskew", threshold, "PNG32:-"], new Map([["/input.png", input]]));
        expect(result.exitCode, result.stderr).toBe(0);
        return decodeImage(result.stdoutBytes!);
    });
    expect(outputs[0]!.data).not.toEqual(outputs[1]!.data);
});
