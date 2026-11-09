import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Original 3x1 RGBA PNG from the reproduction, including its transparent pixel.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAYAAAAb4BS0AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjE6MDI6NDArMDA6MDCNVrz2AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIxOjAyOjQwKzAwOjAw/AsESgAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMTowMjo0MCswMDowMKseJZUAAAAVSURBVAjXY2ByaGj48Ov/AwbGvwwAJxIGCmUo/CQAAAAASUVORK5CYII=", "base64");
const pixels = [2, 64, 128, 128, 240, 250, 255, 224, 0, 1, 253, 0];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["-gamma", "0.125", "-gamma", "8"],
        ["-channel", "R", "-gamma", "0.125", "-gamma", "8"],
        ["-gamma", "0.5", "-gamma", "2"],
        ["+gamma", "8", "+gamma", "0.125"],
        ["-gamma", "1"],
        [],
    ].map(options => ({ options })))(`preserves native reciprocal gamma samples via ${mode}: $options`, async ({ options }) => {
        expect([...decodeImage(input).data]).toEqual(pixels);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const files = new Map([["/in.png", new Uint8Array(input)]]);
        const args = ["/in.png", ...options, "PNG32:/out.png"];
        if (mode === "command") {
            const arguments_ = createCommandArguments(args);
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(stderr).toBe("");
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
        }
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(pixels);
    });
}
