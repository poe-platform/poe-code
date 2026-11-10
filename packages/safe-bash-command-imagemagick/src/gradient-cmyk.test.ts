import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI; CMYK stops interpolate ink channels.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { stops: "cmyk(0%,100%,0%,0%)-cmyk(100%,0%,0%,100%)", options: ["-depth", "8"], output: "rgba", expected: "ff00ffff3f3f7fff000000ff" },
        { stops: "cmyk(0%,100%,0%,0%)-cmyk(100%,0%,0%,100%)", options: ["-depth", "8"], output: "cmyk", expected: "00ff000080800080ff0000ff" },
        { stops: "cmyk(0%,100%,0%,0%)-cmyk(100%,0%,0%,100%)", options: ["-separate", "-format", "%n;"], output: "info", expected: "4;4;4;4;" },
        { size: "1x3", stops: "cmyk(0%,100%,0%,0%)-cmyk(100%,0%,0%,100%)", options: ["-depth", "8"], output: "cmyk", expected: "00ff000080800080ff0000ff" },
        { input: "radial-gradient", size: "5x1", stops: "cmyk(0%,100%,0%,0%)-cmyk(100%,0%,0%,100%)", options: ["-depth", "8"], output: "rgba", expected: "000000ff3f3f7fffff00ffff3f3f7fff000000ff" },
        { stops: "cmyk(0%,100%,0%,0%)-cmyk(100%,0%,0%,100%)", options: ["-depth", "16", "-endian", "MSB"], output: "cmyk", expected: "0000ffff000000008000800000008000ffff00000000ffff" },
        { stops: "cmyka(0%,100%,0%,0%,0)-cmyk(100%,0%,0%,100%)", options: ["-depth", "8"], output: "cmyka", expected: "0000000000ff0000ff80ff0000ffff" },
        { stops: "red-black", options: ["-depth", "8"], output: "rgba", expected: "ff0000ff800000ff000000ff" },
        { stops: "red-gray(20%)", options: ["-separate", "-format", "%n;"], output: "info", expected: "3;3;3;" },
    ])(`${mode}: $input $size $stops $options $output`, async ({ input = "gradient", size = "3x1", stops, options, output, expected }) => {
        const argv = ["-size", size, `${input}:${stops}`, ...options, `${output}:-`];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        const stdout: Buffer[] = [], stderr: Buffer[] = [];
        let bytes: Buffer;
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
                stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
            });
            expect(result.exitCode).toBe(0);
            expect(Buffer.concat(stderr).toString()).toBe("");
            bytes = Buffer.concat(stdout);
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            bytes = Buffer.from(result.stdoutBytes ?? result.stdout);
        }
        expect(bytes.toString(output === "info" ? "utf8" : "hex")).toBe(expected);
    });
}
