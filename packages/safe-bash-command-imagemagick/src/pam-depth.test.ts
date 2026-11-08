import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { encodeImage } from "@poe-code/image-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Header and raster bytes verified against native ImageMagick Q16-HDRI.
for (const mode of ["buffered", "sync", "command"] as const) for (const hasAlpha of [false, true]) for (const sourceDepth of [8, 16] as const) for (const destination of ["/out.pam", "pam:-"]) {
    it.each([
        { depth: undefined, maximum: 255, rgb: "020918689cdc", rgba: "02091880689cdc00" },
        { depth: 1, maximum: 1, rgb: "000000000101", rgba: "0000000100010100" },
        { depth: 4, maximum: 15, rgb: "00010106090d", rgba: "0001010806090d00" },
        { depth: 8, maximum: 255, rgb: "020918689cdc", rgba: "02091880689cdc00" },
        { depth: 16, maximum: 65535, rgb: "018c08ca17d368409c49dcf7", rgba: "018c08ca17d3808068409c49dcf70000" },
    ])(`preserves PAM depth $depth after linear RGB conversion, ${mode}, alpha=${hasAlpha}, source=${sourceDepth}, ${destination}`, async ({ depth, maximum, rgb, rgba }) => {
        if (depth === undefined && sourceDepth === 16) {
            maximum = 65535;
            rgb = "018c08ca17d368409c49dcf7";
            rgba = "018c08ca17d3808068409c49dcf70000";
        }
        const input = encodeImage({ width: 2, height: 1, data: new Uint8Array([18, 52, 86, 128, 171, 205, 239, 0]), hasAlpha, space: "srgb", format: "png", channels: hasAlpha ? 4 : 3, depth: "uchar", density: 72 }, { format: "png", pngColorType: hasAlpha ? 6 : 2, pngBitDepth: sourceDepth }).data;
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const stdout: Uint8Array[] = [];
        const args = ["/in.png", "-colorspace", "RGB", ...(depth === undefined ? [] : ["-depth", String(depth)]), destination];
        const result = mode === "sync" ? runMagickCliSync(args, files) : mode === "buffered" ? await runMagickCli(args, files) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async chunk => { stdout.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)); } }, stderr: { write: async () => {} },
        });
        expect(result.exitCode).toBe(0);
        const output = destination === "pam:-"
            ? mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array()
            : mode === "command" ? await fs.readFile("/out.pam") : files.get("/out.pam")!;
        expect(Buffer.from(output)).toEqual(Buffer.concat([
            Buffer.from(`P7\nWIDTH 2\nHEIGHT 1\nDEPTH ${hasAlpha ? 4 : 3}\nMAXVAL ${maximum}\nTUPLTYPE ${hasAlpha ? "RGB_ALPHA" : "RGB"}\nENDHDR\n`),
            Buffer.from(hasAlpha ? rgba : rgb, "hex"),
        ]));
    });
}
