import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// Synthetic 7x5 image and its 100x0 shear on white, from ImageMagick 7.1.2-35 Q16-HDRI.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAYAAACJmvbYAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAAzAJkARJyxf98AAAAHdElNRQfqCwcKHxfSEpVjAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDEwOjMxOjIzKzAwOjAwqfOOsAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QxMDozMToyMyswMDowMNiuNgwAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTA6MzE6MjMrMDA6MDCPuxfTAAAAOUlEQVQI12O8ayDQwIAGlC98aGBgYGBgQRa0YV6exsDAwMBgLOrDwMDAwMSAB+CVZEThGZ85g8wFAN/QB7YQnSO3AAAAAElFTkSuQmCC", "base64");
const native = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACMAAAAFCAYAAADPLFVyAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCwcKHykTc4jIAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDEwOjMxOjIzKzAwOjAwqfOOsAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QxMDozMToyMyswMDowMNiuNgwAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTA6MzE6NDErMDA6MDDeSw99AAAArUlEQVQoz8XOvQqCUBiH8eekEJUE1XGy6VyA1yJIFxAhXUrdQURCQ5NC0A04RVM0R2NzkqBDLXHaIvqAJvtt78t/eMR5MtI8MTo2zd6AfxBaa/36vGzXXHcbAOb7LouDg2hYVOoWQ98m8GR5Md/kUcgtSwHoJy7HokalJRGmSTxWKKdaXswntywlj0IAjkWNfuKCYWK0JcqpEo9VeTG/mK1SpsvT4w48ydC333Z3mAI38syCCC8AAAAASUVORK5CYII=", "base64");
const keep = new TextEncoder().encode("KEEP");

for (const mode of ["command", "sync"] as const) {
    async function run(geometry: string) {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", keep]]);
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", keep);
        const args = ["/in.png", "-background", "white", "-shear", geometry, "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : runConvertCliSync(args, files);
        if ("stderr" in result) stderr += result.stderr;
        return { exitCode: result.exitCode, stderr, output: mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")! };
    }

    it.each([
        ...[90, -90, 180, -180, 270, -270, 360, -360, 720, -720].flatMap(angle => [`${angle}x0`, `0x${angle}`]),
        "180x180", "180"
    ])(`rejects discontinuous shear %s without replacing output (${mode})`, async geometry => {
        const result = await run(geometry);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("angle is discontinuous");
        expect(result.output).toEqual(keep);
    });

    it(`matches every native pixel for a valid 100x0 shear (${mode})`, async () => {
        const result = await run("100x0");
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        const output = decodeImage(result.output), expected = decodeImage(native);
        expect([output.width, output.height]).toEqual([35, 5]);
        expect(output.data).toEqual(expected.data);
    });

    it.each(["0x0", "-0x-0"])(`preserves pixels for zero shear %s (${mode})`, async geometry => {
        const result = await run(geometry);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        const output = decodeImage(result.output), expected = decodeImage(input);
        expect([output.width, output.height, output.data]).toEqual([expected.width, expected.height, expected.data]);
    });
}
