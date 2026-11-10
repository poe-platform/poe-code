import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");

// Native ImageMagick 7.1.2-35 Q16-HDRI, with RGB endpoints and independent K/alpha.
const cases = [
    { name: "minus levels adjust black", args: ["-colorspace", "CMYK", "-level-colors", "#203040,#c0d0e0", "-channel", "K", "-separate"], hex: "ffffffffffffffffff" },
    { name: "plus levels adjust black", args: ["-colorspace", "CMYK", "+level-colors", "#203040,#c0d0e0", "-channel", "K", "-separate"], hex: "000000000000000000" },
    { name: "unadjusted black", args: ["-colorspace", "CMYK", "-channel", "K", "-separate"], hex: "6e6e6e1818182f2f2f" },
    { name: "plus levels adjust color planes", args: ["-colorspace", "CMYK", "+level-colors", "#203040,#c0d0e0", "-colorspace", "sRGB"], hex: "5087bf4b98bfd5cf51" },
    { name: "CMYK round trip", args: ["-colorspace", "CMYK", "-colorspace", "sRGB"], hex: "0f50911198e7c3d041" },
    { name: "sRGB levels", args: ["-colorspace", "sRGB", "+level-colors", "#203040,#c0d0e0", "-colorspace", "sRGB"], hex: "29629b2b8fd19ab369" },
    { name: "cyan selection preserves black", args: ["-colorspace", "CMYK", "-channel", "C", "+level-colors", "#203040,#c0d0e0", "-channel", "K", "-separate"], hex: "6e6e6e1818182f2f2f" },
    { name: "black selection preserves color planes", args: ["-colorspace", "CMYK", "-channel", "K", "+level-colors", "#203040,#c0d0e0", "-colorspace", "sRGB"], hex: "1a8dff13a8ffefff50" },
    { name: "black selection preserves alpha", args: ["-alpha", "set", "-channel", "A", "-evaluate", "set", "50%", "-colorspace", "CMYK", "-channel", "K", "+level-colors", "#203040,#c0d0e0", "-channel", "A", "-separate"], hex: "808080808080808080" },
    { name: "alpha selection preserves black", args: ["-alpha", "set", "-colorspace", "CMYK", "-channel", "A", "+level-colors", "#203040,#c0d0e0", "-channel", "K", "-separate"], hex: "6e6e6e1818182f2f2f" }
];

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each(cases)(`${mode}: $name`, async ({ args, hex }) => {
        const files = new Map([["a.ppm", input], ["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
        const argv = ["a.ppm", ...args, "-depth", "8", "rgb:out"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
