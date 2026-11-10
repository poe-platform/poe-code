import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["-sigmoidal-contrast", "(5x40%)", "0b54b10cbaf7e3eb3f"],
        ["+sigmoidal-contrast", "(5x40%)", "144d79177ec9a0ac42"],
        ["-sigmoidal-contrast", "5x40%", "0b54b10cbaf7e3eb3f"],
        ["+sigmoidal-contrast", "5x40%", "144d79177ec9a0ac42"],
        ["+sigmoidal-contrast", "5#0x40%", "5862675968726c6e61"],
        ["+sigmoidal-contrast", "50x40%", "5862675968726c6e61"]
    ])(`${mode}: matches native %s %s`, async (option, geometry, expected) => {
        // ImageMagick 7.1.2-35 Q16-HDRI: magick a.ppm OPTION GEOMETRY -depth 8 rgb:out.
        const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["a.ppm", input], ["out", original]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/a.ppm", input);
        await fs.writeFile("/out", original);
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
