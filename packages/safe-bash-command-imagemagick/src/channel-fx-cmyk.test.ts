import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { options: ["-colorspace", "CMYK"], expected: "bf80007fc0" },
        { options: ["-colorspace", "CMYK", "-channel-fx", "b=>b"], expected: "bf80007fc0" },
        { options: ["-colorspace", "CMYK", "-channel-fx", "r=>g"], expected: "bfbf007fc0" },
        { options: ["-colorspace", "CMYK", "-channel-fx", "r<=>g"], expected: "80bf007fc0" },
        { options: ["-colorspace", "CMYK", "-channel-fx", "r=>a"], expected: "bf80007fbf" },
        { options: ["-colorspace", "CMYK", "-channel-fx", "a=>g"], expected: "bfc0007fc0" },
        { options: ["-colorspace", "CMYK", "-channel-fx", "g=25%"], expected: "bf40007fc0" },
        { options: ["-colorspace", "CMYK", "-channel-fx", "r=>g", "-colorspace", "sRGB"], format: "rgba", expected: "202080c0" },
        { options: ["-colorspace", "CMYK", "(", "xc:#80402080", "-colorspace", "CMYK", ")", "-channel-fx", "|b=>g"], expected: "bfbf007fc0" },
        { options: ["-channel-fx", "b=>b"], format: "rgba", expected: "204080c0" },
        { options: ["-colorspace", "CMYK", "-channel-fx", "r=>r", "-format", "%[colorspace]|%[channels]|%[type]"], format: "info", expected: "CMYK|cmyka 5.0|ColorSeparationAlpha" },
    ])(`preserves CMYK inks and alpha in ${mode}: $options`, async ({ options, format = "cmyka", expected }) => {
        // Native ImageMagick 7.1.2-35 Q16-HDRI reference outputs.
        const fs = new MemoryFileSystem();
        const argv = ["xc:#204080c0", ...options, "-depth", "8", `${format}:-`];
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        let output: Buffer;
        if (mode === "command") {
            const result = await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            output = Buffer.concat(chunks);
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, new Map())
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            output = Buffer.from(result.stdoutBytes ?? result.stdout);
        }
        expect(output.toString(format === "info" ? "utf8" : "hex")).toBe(expected);
    });
}

for (const mode of ["sync", "retained"] as const) {
    it(`preserves 16-bit CMYK assignments across storage chunks in ${mode}`, async () => {
        const argv = ["-size", "513x1", "xc:#204080c0", "-colorspace", "CMYK", "-channel-fx", "r=>g", "-depth", "16", "-endian", "MSB", "cmyka:-"];
        const result = mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, { filesystem: new MemoryFileSystem(), cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe("bfffbfff00007f7fc0c0".repeat(513));
    });
}
