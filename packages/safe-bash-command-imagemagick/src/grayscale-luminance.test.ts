import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI: 8x8 RGBA PNG and first-pixel oracle values.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjM6MDc6NTcrMDA6MDACLvzpAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIzOjA3OjU3KzAwOjAwc3NEVQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMzowNzo1NyswMDowMCRmZYoAAAETSURBVBjTAQgB9/4AJXjLHo7hNIf3Sp3wYLMGWckcb8Iyhdgrm+5BlARXqv0AbcATZtYpfM8/kuU4qPtOoRFktwp6zSBz4zaJ3Eyf8kUAtQhbrh5xxBeH2i2A8EOW6Vms/1LCFWi7K37RJJTnOo0A/VCj9ma5DF/PInXIOIveMaH0R5oKXbADc8YZbNwvgtUARZjrPq4BVKcXar0QgNMmeek8j+JSpfhLuw5htCR3yh0AjeAzhvZJnO9fsgVYyBtuwTGE1yqa7UCTA1ap/Gy/EmUA1Sh7zj6R5Den+k2gEGO2CXnMH3LiNYjbS57xRLQHWq0AHXDDFobZLH/vQpXoWKv+UcEUZ7oqfdAjk+Y5jPxPovUcJoEBTbp3hAAAAABJRU5ErkJggg==", "base64");

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const [method, linearGray, srgbGray] of [["Rec709Luminance", 46, 118], ["Rec601Luminance", 47, 119]] as const) {
        for (const convert of [false, true]) {
            it(`${mode}: preserves ${method} state and PNG gamma, sRGB=${convert}`, async () => {
                const argv = ["in.png", "-grayscale", method, ...(convert ? ["-colorspace", "sRGB", "PNG32:out.png"] : ["PNG:out.png"])];
                const files = new Map<string, Uint8Array>([["in.png", input]]);
                const fs = new MemoryFileSystem();
                await fs.writeFile("/in.png", input);
                const args = createCommandArguments(argv);
                let stderr = "";
                const result = mode === "sync" ? runMagickCliSync(argv, files)
                    : mode === "buffered" ? await runMagickCli(argv, files)
                    : await createMagickCommand().execute({
                        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                        signal: new AbortController().signal, stdin: (async function* () {})(),
                        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                    });
                expect(result.exitCode).toBe(0);
                expect(stderr).toBe("");
                const output = mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!;
                const pixels = decodeImage(output).data, gray = convert ? srgbGray : linearGray;
                expect([...pixels.subarray(0, 4)]).toEqual([gray, gray, gray, 30]);
                expect(pixels.filter((_, i) => i % 4 === 3)).toEqual(decodeImage(input).data.filter((_, i) => i % 4 === 3));
                expect(readImageMetadata(output).gamma).toBe(convert ? 0.45455 : 1);
                const identified = await runMagickCli(["identify", "-format", "%[colorspace]|%[gamma]", "out.png"], mode === "command" ? { filesystem: fs, cwd: "/" } : files);
                expect(identified.exitCode).toBe(0);
                expect(identified.stdout).toBe(convert ? "sRGB|0.45455" : "LinearGray|1");
                if (!convert) {
                    const converted = await runMagickCli(["out.png", "-colorspace", "sRGB", "PNG32:reread.png"], mode === "command" ? { filesystem: fs, cwd: "/" } : files);
                    expect(converted.exitCode).toBe(0);
                    const reread = mode === "command" ? await fs.readFile("/reread.png") : files.get("reread.png")!;
                    expect([...decodeImage(reread).data.subarray(0, 4)]).toEqual([srgbGray, srgbGray, srgbGray, 30]);
                }
            });
        }
    }
}

for (const retained of [false, true]) {
    it.each(["Rec709Luma", "Mean"])(`keeps ordinary %s gray unchanged by sRGB conversion, retained=${retained}`, async method => {
        const files = new Map<string, Uint8Array>([["in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const result = await runMagickCli(["in.png", "-grayscale", method, "-write", "PNG32:gray.png", "-colorspace", "sRGB", "PNG32:out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const gray = retained ? await filesystem.readFile("/gray.png") : files.get("gray.png")!;
        const output = retained ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect(decodeImage(output).data).toEqual(decodeImage(gray).data);
        const identified = await runMagickCli(["identify", "-format", "%[colorspace]", "gray.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(identified.stdout).toBe("sRGB");
    });
}
