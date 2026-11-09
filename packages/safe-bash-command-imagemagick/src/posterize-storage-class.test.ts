import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: posterize produces PseudoClass; subsequent
// red-channel solarize updates the whole colormap, yielding opaque black.
const source = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAwAAAAICAIAAABChommAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjM6MjI6MDUrMDA6MDBjFJEhAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIzOjIyOjA1KzAwOjAwEkkpnQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMzoyMjowNSswMDowMEVcCEIAAAAZSURBVBjTY1TN23773bt3eDHTeyLA8FYEAOvcCrCvb6/xAAAAAElFTkSuQmCC", "base64");

for (const mode of ["public", "memory", "sync"] as const) {
    it.each([
        ["+dither", "-posterize", "2"],
        ["+dither", "-posterize", "%[fx:1+1]"],
        ["-posterize", "2"],
        ["-dither", "FloydSteinberg", "-posterize", "2"]
    ])(`${mode}: retains indexed working pixels after %j`, async (...operation) => {
        const files = new Map<string, Uint8Array>([["/rgb.png", source]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/rgb.png", source);
        const args = ["/rgb.png", ...operation, "-channel", "R", "-solarize", "40%", "+channel",
            "-write", "PNG32:/out.png", "-format", "%r", "info:"];
        let stdout = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
        expect(result.exitCode).toBe(0);
        const output = mode === "public" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(Array.from({ length: 12 * 8 }, () => [0, 0, 0, 255]).flat());
        expect(mode === "public" ? stdout : ("stdout" in result ? result.stdout : "")).toContain("PseudoClass");
    });

    it(`${mode}: depth reduction keeps direct working pixels`, async () => {
        const files = new Map<string, Uint8Array>([["/rgb.png", source]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/rgb.png", source);
        const args = ["/rgb.png", "-depth", "1", "-format", "%r", "info:"];
        let stdout = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
        expect(result.exitCode).toBe(0);
        expect(mode === "public" ? stdout : ("stdout" in result ? result.stdout : "")).toContain("DirectClass");
    });
}
