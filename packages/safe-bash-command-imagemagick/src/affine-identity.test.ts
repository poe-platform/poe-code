import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// Input and native default output from ImageMagick 7.1.2-35 Q16-HDRI.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABMAAAAPCAIAAACJJmN7AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMDk6NTk6NTgrMDA6MDBAybJ6AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDA5OjU5OjU4KzAwOjAwMZQKxgAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QwOTo1OTo1OCswMDowMGaBKxkAAAA5SURBVCjPY2RgEOFlYuBlYuBleg1jiBIjwsLEz8DERA6iSOdrGEcUxiBKZIBcS5oj4SKjYTu8whYAfS4XOob+v0EAAAAASUVORK5CYII=", "base64");
const native = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABMAAAAPCAIAAACJJmN7AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCwcKAA3iKmKHAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDA5OjU5OjU4KzAwOjAwQMmyegAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QwOTo1OTo1OCswMDowMDGUCsYAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTA6MDA6MTMrMDA6MDB3FB0PAAAAcUlEQVQoz9WQsQqAMAxE46NToWSxo1/h/3+CX+IUx05O6dBB2+IihBDuuNxxi8iakIQkTj9yDxJQgZmpSgUb2gE9QcBgd+Jw+glpPMWJd6Qqx6KCBTT7v66QFWk8B2L/pduIlbluL3Sb6zZi5ZNuh+cGmGdqRffFB1gAAAAASUVORK5CYII=", "base64");

for (const mode of ["public", "sync"] as const) {
    it.each([false, true])(`matches native identity Affine resampling with point=%s (${mode})`, async point => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const files = new Map<string, Uint8Array>([["/input.png", input]]);
        const args = ["/input.png", ...(point ? ["-filter", "point"] : []), "-distort", "Affine", "0,0 0,0 10,0 10,0 0,10 0,10", "/out.png"];
        const argumentValues = createCommandArguments(args);
        const context = {
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
        } as unknown as CommandContext;
        const result = mode === "public" ? await createMagickCommand().execute(context) : runConvertCliSync(args, files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "public" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        const expected = decodeImage(point ? input : native);
        expect([output.width, output.height]).toEqual([19, 15]);
        expect(Array.from(output.data.slice((6 * 19 + 8) * 4, (6 * 19 + 9) * 4))).toEqual([116, 106, point ? 20 : 35, 255]);
        expect(output.data).toEqual(expected.data);
    });
}
