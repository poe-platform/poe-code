import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI returns an opaque, indexed sRGB image for either result.
for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each([
        { settings: ["-colorspace", "sRGB"], range: "black-white", pixel: 255 },
        { settings: ["-colorspace", "sRGB"], range: "black-black", pixel: 0 },
        { settings: ["-colorspace", "Gray"], range: "black-white", pixel: 255 },
        { settings: ["-colorspace", "Gray"], range: "black-black", pixel: 0 },
        { settings: ["-type", "Palette"], range: "black-white", pixel: 255 },
    ])(`${mode}: returns indexed sRGB for $settings and $range`, async ({ settings, range, pixel }) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const argv = ["xc:red", ...settings, "-color-threshold", range,
            "-format", "%r/%[colorspace]/%[channels]/%[pixel:p{0,0}]", "info:"];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(argv);
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toBe(`PseudoClass sRGB /sRGB/srgb  4.0/srgb(${pixel},${pixel},${pixel})`);
    });
}

for (const mode of ["sync", "retained"] as const) {
    it(`replaces the source PNG colormap and indices (${mode})`, async () => {
        const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEX/AAAA/wAAAP///wDWAo97AAAADUlEQVR4nGNgYGRiBgAADwAHhI6ZbQAAAABJRU5ErkJggg==", "base64");
        const files = new Map<string, Uint8Array>([["/input.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const argv = ["/input.png", "-color-threshold", "red-red", "-depth", "8", "map:/out"];
        const result = mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, { filesystem: fs, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        const output = mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect([...output]).toEqual([0, 0, 0, 255, 255, 255, 1, 0, 0, 0]);
    });
}
