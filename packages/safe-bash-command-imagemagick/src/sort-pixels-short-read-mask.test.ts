import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: mask extent does not limit pixel sorting.
const cases = [
    { name: "one-pixel mask", operations: ["-read-mask", "mask1.pgm", "-sort-pixels"] },
    { name: "two-pixel mask", operations: ["-read-mask", "mask2.pgm", "-sort-pixels"] },
    { name: "full-width mask", operations: ["-read-mask", "mask4.pgm", "-sort-pixels"] },
    { name: "removed short mask", operations: ["-read-mask", "mask1.pgm", "+read-mask", "-sort-pixels"] },
    { name: "unmasked", operations: ["-sort-pixels"] },
];

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each(cases)(`${mode}: sorts RGBA16 scanlines with $name`, async ({ operations }) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        for (const width of [1, 2, 4]) {
            const mask = Buffer.concat([Buffer.from(`P5\n${width} 1\n255\n`), Buffer.alloc(width, 255)]);
            files.set(`mask${width}.pgm`, mask);
            await fs.writeFile(`/mask${width}.pgm`, mask);
        }
        const argv = ["xc:#d010a040", "xc:#60606090", "xc:#109090c0", "xc:#d010a040", "+append",
            ...operations, "+read-mask", "-depth", "16", "-endian", "MSB", "rgba:-"];
        const args = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stderr } : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        const output = "stdoutBytes" in result ? result.stdoutBytes! : Buffer.concat(chunks);
        expect(Buffer.from(output).toString("hex")).toBe("d0d01010a0a04040d0d01010a0a040406060606060609090101090909090c0c0");
    });
}

for (const mode of ["buffered", "sync", "retained"] as const) {
    it.each([
        { width: 4, maskWidth: 1, maskHeight: 1, mean: "0.815686" },
        { width: 4, maskWidth: 2, maskHeight: 2, mean: "0.298039" },
        { width: 4, maskWidth: 6, maskHeight: 1, mean: "0.517647" },
        { width: 515, maskWidth: 2, maskHeight: 1, mean: "0.596078" },
    ])(`${mode}: carries a $maskWidth x $maskHeight selection through $width-pixel rows`, async ({ width, maskWidth, maskHeight, mean }) => {
        const pixels = Buffer.alloc(width * 2 * 4);
        pixels.set(Buffer.from("d010a04060606090109090c0d010a040", "hex"));
        const input = Buffer.concat([Buffer.from(`P7\nWIDTH ${width}\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`), pixels]);
        const mask = Buffer.concat([Buffer.from(`P5\n${maskWidth} ${maskHeight}\n255\n`), Buffer.alloc(maskWidth * maskHeight, 255)]);
        const files = new Map<string, Uint8Array>([["in.pam", input], ["mask.pgm", mask]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile("/" + path, bytes);
        const argv = ["in.pam", "-alpha", "opaque", "-read-mask", "mask.pgm", "-sort-pixels", "-format", "%[fx:mean.r]", "info:-"];
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toBe(mean);
    });
}
