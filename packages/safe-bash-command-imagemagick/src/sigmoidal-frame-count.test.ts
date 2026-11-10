import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    // ImageMagick 7.1.2-35 Q16-HDRI, two identical PPM inputs and 8-bit RGB output.
    it.each([
        ["-sigmoidal-contrast", "%[fx:n]", "0d4d920f9aeac7d43d"],
        ["+sigmoidal-contrast", "%[fx:n]", "1153901396e4bfcc45"],
        ["-sigmoidal-contrast", "2", "0d4d920f9aeac7d43d"],
        ["-sigmoidal-contrast", "1", "0e4f911098e8c4d140"],
        ["+sigmoidal-contrast", "2", "1153901396e4bfcc45"],
        ["+sigmoidal-contrast", "1", "1051911298e6c2cf42"]
    ])(`${mode}: matches native %s %s for the full frame stack`, async (operator, strength, expected) => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["/a.ppm", input], ["/out", sentinel]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/a.ppm", input);
        await fs.writeFile("/out", sentinel);
        const argv = ["/a.ppm", "/a.ppm", operator, strength, "+append", "-depth", "8", "rgb:/out"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected.repeat(2));
    });
}
