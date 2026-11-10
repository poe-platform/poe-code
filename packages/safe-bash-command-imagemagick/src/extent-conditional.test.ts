import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, parseMagickGeometry, runMagickCli, runMagickCliSync } from "./index.js";

it.each([ ["2x2<", true, false], ["8x6>", false, true] ] as const)("parses conditional extent %s", (geometry, enlargeOnly, shrinkOnly) => {
    expect(parseMagickGeometry(geometry)).toMatchObject({ enlargeOnly, shrinkOnly });
});

// Dimensions and grayscale pixels verified with native ImageMagick.
const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const expanded = [
    255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 1, 2, 3, 4, 255, 255,
    255, 255, 5, 6, 7, 8, 255, 255,
    255, 255, 9, 10, 11, 12, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255,
];
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        ["2x2<", "NorthWest", 4, 3, original],
        ["8x6>", "Center", 4, 3, original],
        ["8x6<", "Center", 8, 6, expanded],
        ["2x2>", "Center", 2, 2, [2, 3, 6, 7]],
        ["2x6<", "Center", 2, 6, [255, 255, 2, 3, 6, 7, 10, 11, 255, 255, 255, 255]],
        ["2x6>", "Center", 2, 6, [255, 255, 2, 3, 6, 7, 10, 11, 255, 255, 255, 255]],
        ["2x2+1+1<", "Center", 4, 3, original],
        ["4x2<", "NorthWest", 4, 2, [1, 2, 3, 4, 5, 6, 7, 8]],
        ["4x4>", "NorthWest", 4, 4, [...original, 255, 255, 255, 255]],
    ] as const)(`honors extent %s with %s gravity (${mode})`, async (geometry, gravity, width, height, values) => {
        const pixels = Uint8Array.from(original.flatMap(value => [value, value, value, 255]));
        const input = await sharp(pixels, { raw: { width: 4, height: 3, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const args = ["/input.png", "-gravity", gravity, "-extent", geometry, "/output.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} },
            stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        const output = decodeImage(mode === "retained" || mode === "command" ? await fs.readFile("/output.png") : files.get("/output.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(output.data).toEqual(Uint8Array.from(values.flatMap(value => [value, value, value, 255])));
    });
}

// Native ImageMagick 7.1.2-35 Q16-HDRI: restrictions retain dimensions,
// but still composite the source onto the background canvas.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        { geometry: "2x2<", compose: "Over", expected: "37809db0" },
        { geometry: "2x2<", compose: "Clear", expected: "00000000" },
        { geometry: "2x2<", compose: "Copy", expected: "4080c080" },
        { geometry: "6x5>", compose: "Over", expected: "37809db0" },
        { geometry: "4x3", compose: "Over", expected: "37809db0" },
        { geometry: "2x2<", compose: undefined, expected: "4x3 4,3,+0,+0" },
        { geometry: "6x5>", compose: undefined, expected: "4x3 4,3,+0,+0" },
    ])(`composites retained extent dimensions $geometry $compose (${mode})`, async ({ geometry, compose, expected }) => {
        const files = new Map([["out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", Buffer.from("KEEP"));
        const args = ["-size", "4x3", "xc:#4080c080",
            ...(compose ? ["-background", "#20804060", "-compose", compose] : []), "-extent", geometry,
            ...(compose ? ["+repage", "-crop", "1x1+0+0", "-depth", "8", "rgba:out"]
                : ["-format", "%wx%h %W,%H,%X,%Y", "info:out"])];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(bytes).toString(compose ? "hex" : "utf8")).toBe(expected);
    });
}
