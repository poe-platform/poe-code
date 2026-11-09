import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([false, true])(`${mode}: shares the image-list palette with +remap=%s`, async remap => {
        const input = await sharp(Uint8Array.from([180,50,80,70,90,150,200,245,30,20,30,80,80,255,240,200,180,130]), { raw: { width: 6, height: 1, channels: 3 } }).png().toBuffer();
        const palette = await sharp(Uint8Array.from([255,0,0,0,128,0,0,0,255,255,255,255]), { raw: { width: 4, height: 1, channels: 3 } }).png().toBuffer();
        const files = new Map([["/input.png", input], ["/palette.png", palette]]), fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/input.png", "+dither", "-colors", "2", "/palette.png", ...(remap ? ["+remap"] : []), "+append", "PNG24:/out.png"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result) stderr += result.stderr;
        expect(stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([10, 1]);
        const pixels = Array.from({ length: 10 }, (_, i) => Buffer.from(output.data.slice(i * 4, i * 4 + 3)).toString("hex"));
        // ImageMagick 7.1.2-35 Q16-HDRI, including the unchanged no-remap control.
        expect(pixels).toEqual(remap
            ? ["9a634e", "9a634e", "9a634e", "9a634e", "54a0bc", "9a634e", "9a634e", "9a634e", "54a0bc", "54a0bc"]
            : ["86775e", "86775e", "86775e", "86775e", "50fff0", "86775e", "ff0000", "008000", "0000ff", "ffffff"]);
    });
}

for (const retained of [false, true]) {
    it.each([
        { size: "2x2", second: "1x3", colors: ["-colors", "1"], dither: ["+dither"], width: 3, height: 3, pixels: ["92006d", "92006d", "92006d", "92006d", "92006d", "92006d", "ffffff", "ffffff", "92006d"] },
        { size: "1x1", second: "1x1", colors: [], dither: [], width: 2, height: 1, pixels: ["ff0000", "0000ff"] },
        { size: "1x1", second: "1x1", colors: [], dither: ["-alpha", "off", "+dither"], width: 2, height: 1, pixels: ["ff0000", "0000ff"] },
        { size: "1025x1", second: "1025x1", colors: ["-colors", "1"], dither: ["-dither", "FloydSteinberg"], width: 2050, height: 1, pixels: Array(2050).fill("800080") }
    ])(`builds a shared palette without padding, retained=${retained}: $size/$second`, async ({ size, second, colors, dither, width, height, pixels }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const result = await runConvertCli(["-size", size, "xc:red", ...dither, ...colors, "-size", second, "xc:blue", "+remap", "+append", "PNG24:/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(Array.from({ length: width * height }, (_, i) => Buffer.from(output.data.slice(i * 4, i * 4 + 3)).toString("hex"))).toEqual(pixels);
    });
}
