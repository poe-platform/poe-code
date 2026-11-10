import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["-sigmoidal-contrast", "5x0x10%", "198dd91cdefcf3f774"],
        ["+sigmoidal-contrast", "5,0x10%", "092d530a57a7788625"],
        ["+sigmoidal-contrast", "5x16%", "092d530a57a7788625"],
        ["-sigmoidal-contrast", "5x0x4000", "1378ce15d4fbeff460"],
        ["-sigmoidal-contrast", "5x16384", "1378ce15d4fbeff460"],
        ["-sigmoidal-contrast", "5x0%", "26a9e62be9fdf7fa92"]
    ])(`${mode}: %s %s matches native midpoint pixels`, async (option, geometry, expected) => {
        // ImageMagick 7.1.2-35 Q16-HDRI, with the same PPM and argv.
        const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["a.ppm", input], ["out", sentinel]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/a.ppm", input);
        await fs.writeFile("/out", sentinel);
        const argv = ["a.ppm", option, geometry, "-depth", "8", "rgb:out"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
