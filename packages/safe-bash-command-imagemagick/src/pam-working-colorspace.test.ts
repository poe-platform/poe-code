import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Raster bytes captured from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["buffered", "sync", "command"] as const) {
    for (const depth of [8, 16]) for (const alpha of [false, true]) {
        it.each([
            { space: "HSL", rgb8: "93707d", rgb16: "936470a37d7d" },
            { space: "Lab", rgb8: "867b5f", rgb16: "86507be95fac" },
            { space: "XYZ", rgb8: "303476", rgb16: "2ffd34a3762b" },
            { space: "RGB", rgb8: "103974", rgb16: "0fae392574d7" },
            { space: "CMYK", rgb8: "9c47004b", rgb16: "9c71471c00004b4b" },
        ])(`writes active $space channels to PAM files and stdout, ${mode}, depth=${depth}, alpha=${alpha}`, async ({ space, rgb8, rgb16 }) => {
            const args = ["xc:#4682b4" + (alpha ? "80" : ""), "-colorspace", space, "-depth", String(depth), "-write", "/out.pam", "pam:-"];
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem(), stdout: Uint8Array[] = [];
            const result = mode === "sync" ? runMagickCliSync(args, files) : mode === "buffered" ? await runMagickCli(args, files) : await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async chunk => { stdout.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)); } }, stderr: { write: async () => {} },
            });
            expect(result.exitCode).toBe(0);
            const channels = (space === "CMYK" ? 4 : 3) + Number(alpha);
            const expected = Buffer.concat([
                Buffer.from(`P7\nWIDTH 1\nHEIGHT 1\nDEPTH ${channels}\nMAXVAL ${2 ** depth - 1}\nTUPLTYPE ${space === "CMYK" ? "CMYK" : "RGB"}${alpha ? "_ALPHA" : ""}\nENDHDR\n`),
                Buffer.from((depth === 8 ? rgb8 : rgb16) + (alpha ? depth === 8 ? "80" : "8080" : ""), "hex"),
            ]);
            expect(Buffer.from(mode === "command" ? await fs.readFile("/out.pam") : files.get("/out.pam")!)).toEqual(expected);
            expect(mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes) : undefined).toEqual(expected);
        });
    }

    it.each([
        { space: "HSL", rgb: "46468282b4b4" },
        { space: "Lab", rgb: "464a8282b4b3" },
        { space: "XYZ", rgb: "464a8282b4b3" },
    ])(`keeps PPM conversion and explicit sRGB PAM conversion, ${mode}, $space`, async ({ space, rgb }) => {
        const args = ["xc:#4682b4", "-colorspace", space, "-depth", "16", "-write", "/out.ppm", "-colorspace", "sRGB", "/out.pam"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const result = mode === "sync" ? runMagickCliSync(args, files) : mode === "buffered" ? await runMagickCli(args, files) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} },
        });
        expect(result.exitCode).toBe(0);
        for (const [path, header] of [["/out.ppm", "P6\n1 1\n65535\n"], ["/out.pam", "P7\nWIDTH 1\nHEIGHT 1\nDEPTH 3\nMAXVAL 65535\nTUPLTYPE RGB\nENDHDR\n"]] as const) {
            const output = mode === "command" ? await fs.readFile(path) : files.get(path)!;
            expect(Buffer.from(output)).toEqual(Buffer.concat([Buffer.from(header), Buffer.from(rgb, "hex")]));
        }
    });
}
