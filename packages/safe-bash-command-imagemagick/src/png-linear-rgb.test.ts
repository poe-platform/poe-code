import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI 8x8 RGB PNG.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjM6MTQ6MzcrMDA6MDDu+JGtAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIzOjE0OjM3KzAwOjAwn6UpEQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMzoxNDozNyswMDowMMiwCM4AAABWSURBVAjXY2QXipLhEXnHIyLzXuQdz6F370VkeETevRdh0uD884vzz683UBLK5fzDhMaHK2L69cYPie8HEdWA6oCp0niD0MSEwkcxCpUPt48J0z0QLgBsBn+1t2kzRgAAAABJRU5ErkJggg==", "base64");

for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        { options: [], gamma: 0.45455 },
        { options: ["-colorspace", "sRGB"], gamma: 0.45455 },
        { options: ["-colorspace", "RGB"], gamma: 1 },
        { options: ["-colorspace", "RGB", "-colorspace", "sRGB"], gamma: 0.45455 }
    ])(`${mode}: preserves PNG32 transfer curve for $options`, async ({ options, gamma }) => {
        const files = new Map<string, Uint8Array>([["rgb.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/rgb.png", input);
        const argv = ["rgb.png", ...options, "PNG32:out.png"];
        if (mode === "command") {
            const args = createCommandArguments(argv);
            const errors: Uint8Array[] = [];
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes); } }
            });
            expect(result.exitCode).toBe(0);
            expect(Buffer.concat(errors).toString()).toBe("");
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        }
        const output = mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!;
        const pixels = decodeImage(output).data;
        expect([output[24], output[25]]).toEqual([8, 6]);
        // Native linear RGB first pixel; controls retain the original sRGB samples.
        if (gamma === 1) expect([...pixels.slice(0, 4)]).toEqual([1, 2, 26, 255]);
        else expect(pixels).toEqual(decodeImage(input).data);
        expect(readImageMetadata(output).gamma ?? 0.45455).toBe(gamma);
    });
}
