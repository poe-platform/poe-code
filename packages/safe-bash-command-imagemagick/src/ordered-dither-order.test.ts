import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAABCAIAAABYG7kIAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDI6MDU6NTMrMDA6MDBAhnLVAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAyOjA1OjUzKzAwOjAwMdvKaQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMjowNTo1MyswMDowMGbO67YAAAAsSURBVAjXJcehEQAwDAMxlz00i2Gg95+wIER3epKAE0hie3clJWl7tQ3MzAc6ZAL/kFjY/QAAAABJRU5ErkJggg==", "base64");

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { value: "o3x3,4", before: true },
        { value: "o3x3,%[fx:w]", before: true },
        { value: "o3x3,4", before: false },
    ])(`${mode}: ordered dithering $value with before=$before preserves native behavior`, async ({ value, before }) => {
        const keep = new TextEncoder().encode("KEEP");
        const fs = new MemoryFileSystem();
        await fs.writeFile("/g.png", input);
        await fs.writeFile("/o.png", keep);
        const files = new Map<string, Uint8Array>([["/g.png", input], ["/o.png", keep]]);
        const argv = [...(before ? ["-ordered-dither", value, "/g.png"] : ["/g.png", "-ordered-dither", value]), "PNG24:/o.png"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result) stderr += result.stderr;
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/o.png") : files.get("/o.png")!;
        expect(result.exitCode).toBe(before ? 1 : 0);
        if (before) {
            expect(stderr).toContain("no images found for operation '-ordered-dither'");
            expect(output).toEqual(keep);
        } else {
            // Native ImageMagick RGB8 ramp after o3x3,4 dithering.
            const levels = [0, 0, 0, 0, 0, 85, 85, 85, 85, 170, 170, 170, 255, 170, 255, 255];
            expect([...decodeImage(output).data]).toEqual(levels.flatMap(level => [level, level, level, 255]));
        }
    });
}
