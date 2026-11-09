import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTg6NDk6NDQrMDA6MDDK1D+jAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE4OjQ5OjQ0KzAwOjAwu4mHHwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxODo0OTo0NCswMDowMOycpsAAAAAiSURBVAjXY/jPwPCf4T9DAwPDfwZGThG5/9wicgxcInIMAGh4BjFUybDVAAAAAElFTkSuQmCC", "base64");

// ImageMagick 7.1.2-35 Q16-HDRI, using the same PNG32 input for both output depths.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const depth of [8, 16]) {
        for (const background of ["#204080", "none"]) {
            it.each([
                { geometry: "7x6+1+1", gravity: "Center", compose: false, width: 7, height: 6, left: 1, top: 1 },
                { geometry: "5x4+0+0", gravity: "NorthWest", compose: true, width: 5, height: 4, left: 0, top: 0 },
                { geometry: "5x4+0+0", gravity: "Center", compose: true, width: 5, height: 4, left: 1, top: 1 },
                { geometry: "5x4+0+0", gravity: "SouthEast", compose: true, width: 5, height: 4, left: 2, top: 2 },
            ])(`preserves blend precision for $geometry/$gravity (${mode}, ${depth}-bit, ${background})`, async ({ geometry, gravity, compose, width, height, left, top }) => {
                const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/in.png", input);
                const args = ["/in.png", "-background", background, "-gravity", gravity,
                    ...(compose ? ["-compose", "Over"] : []), "-extent", geometry, `PNG${depth === 8 ? 32 : 64}:/out.png`];
                const argumentValues = createCommandArguments(args);
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
                expect(bytes[24]).toBe(depth);
                const output = decodeImage(bytes);
                expect([output.width, output.height]).toEqual([width, height]);
                const scale = depth === 8 ? 1 : 257;
                const padding = background === "none" ? [0, 0, 0, 0] : [32, 64, 128, 255].map(value => value * scale);
                const green = background === "none" ? [0, 255 * scale, 0, 128 * scale]
                    : depth === 8 ? [16, 160, 64, 255] : [4096, 41088, 16383, 65535];
                const pixels = [[255 * scale, 0, 0, 255 * scale], green, padding,
                    ...[[9, 20, 30, 255], [20, 40, 60, 255], [30, 60, 90, 255]].map(pixel => pixel.map(value => value * scale))];
                const expected = Array.from({ length: width * height }, (_, index) => {
                    const x = index % width - left, y = Math.floor(index / width) - top;
                    return x >= 0 && x < 3 && y >= 0 && y < 2 ? pixels[y * 3 + x]! : padding;
                }).flat();
                expect(Array.from(depth === 8 ? output.data : output.data16 ?? [])).toEqual(expected);
            });
        }
    }
}
