import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// Input and doubled Point-filter output from ImageMagick 7.1.2-35 Q16-HDRI.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAIAAAAiZtkUAAAAH0lEQVR4nGOUdsmtRgWMf9X80YXucxiiCx18JYwmBADurCHtclsDfQAAAABJRU5ErkJggg==", "base64");
const doubled = decodeImage(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAwAAAAICAMAAAD6Ou7DAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAERUExURRtEbTpjjHegyXWexzJbhDBZgm2Wv2uUvShReiZPeGOMtYKr1FQ9ZmJbhICZwn2Wv1tUfVhRenaPuHOMtVFKc05HcGyFrnukzcUuV7NMdZGKs46HsKxFbqlCa4eAqYR9pqI7ZJ84YX12n2yVvvYfSNQ9ZpJ7pI+Ioc1mX8pjXIiBmoV+l8NcVcBZUn53kF2Gr+cQOYNslYCZkr63ULu0TXmSi3aPiLStRrGqQ2+IgU53oNhBKrZPSHRthnGag6/YQazVPmqTfGeQiaXOZ6LLZGCJgj9okcmyG6egOWV+d2KLdKDJMp3GL1uEbViBmpa/uJO8tVF6k8HqE12Gb5jBKpa/KFN8ZVF6o4634Iy13klym6FEuTEAAAAHdElNRQfqCwcJGw7QU0b+AAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDA5OjI3OjEzKzAwOjAw8XbNSgAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QwOToyNzoxMyswMDowMIArdfYAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMDk6Mjc6MTQrMDA6MDASmWqnAAAAcElEQVQI12NgYGRiZmFlY+fg5OJm4OHl4xcQFBIWERUTZ5CQlJKWkZWTV1BUUmZQUVVT19DU0tbR1dNnMJAwNDI2MTUzt7C0YrC2sbWzd3B0cnZxdWNw9/D08vbx9fMPCGRlCPIO9g0JDQuPiIziAABYCBC9Mm2VZgAAAABJRU5ErkJggg==", "base64"));
const source = decodeImage(input);
const identity = ["-distort", "PerspectiveProjection", "1,0,0,0,1,0,0,0"];

for (const mode of ["public", "sync"] as const) {
    async function run(options: string[], success = true) {
        const keep = new TextEncoder().encode("KEEP");
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/input.png", input], ["/out.png", keep]]);
        await fs.writeFile("/input.png", input);
        await fs.writeFile("/out.png", keep);
        const args = ["/input.png", "-filter", "point", ...options, "/out.png"];
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : runConvertCliSync(args, files);
        expect(result.exitCode).toBe(success ? 0 : 1);
        const bytes = mode === "public" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        if (!success) { expect(bytes).toEqual(keep); return source; }
        return decodeImage(bytes);
    }

    it.each(["2", "-2"])(`matches native doubled pixels for scale=%s (${mode})`, async scale => {
        const output = await run(["-define", `distort:scale=${scale}`, ...identity]);
        expect([output.width, output.height]).toEqual([12, 8]);
        expect(output.data).toEqual(doubled.data);
    });

    it.each([["SRT", "0"], ["Affine", "0,0,0,0 6,0,6,0 0,4,0,4"], ["BarrelInverse", "0,0,0,1"]])(`scales %s with the selected Point filter (${mode})`, async (method, coefficients) => {
        const output = await run(["-define", "distort:scale=2", "-distort", method, coefficients]);
        expect([output.width, output.height]).toEqual([12, 8]);
        expect(output.data).toEqual(doubled.data);
    });

    it(`halves dimensions and samples pixel centers (${mode})`, async () => {
        const output = await run(["-define", "distort:scale=0.5", ...identity]);
        expect([output.width, output.height]).toEqual([3, 2]);
        const expected = Uint8Array.from([138, 115, 156, 255, 128, 105, 146, 255, 118, 95, 136, 255, 142, 119, 96, 255, 132, 173, 86, 255, 122, 163, 140, 255]);
        expect(output.data).toEqual(expected);
    });

    it.each(["-distort", "+distort"])(`scales viewport dimensions and origin with %s (${mode})`, async operator => {
        const output = await run(["-define", "distort:scale=2", "-define", "distort:viewport=3x2+1+1", operator, ...identity.slice(1)]);
        expect([output.width, output.height]).toEqual([6, 4]);
        expect(output.virtualCanvas).toEqual({ width: 6, height: 4, x: 2, y: 2 });
        const expected = Uint8Array.from({ length: 6 * 4 * 4 }, (_, i) => doubled.data[((Math.floor(i / 24) + 2) * 12 + Math.floor(i / 4) % 6 + 2) * 4 + i % 4]!);
        expect(output.data).toEqual(expected);
    });

    it.each([["-define", "distort:scale=1"], ["-define", "distort:scale=2", "+define", "distort:scale"]])(`preserves identity pixels with %j (${mode})`, async (...options) => {
        const output = await run([...options, ...identity]);
        expect([output.width, output.height]).toEqual([6, 4]);
        expect(output.data).toEqual(source.data);
    });

    // Native references cover dimension rounding and the default EWA footprint.
    it.each([
        { name: "fractional viewport", args: ["-filter", "point", "-define", "distort:scale=0.75", "-define", "distort:viewport=3x3+1+1", ...identity],
            width: 2, height: 2, x: 1, y: 1, pixels: [167, 144, 121, 255, 117, 137, 157, 255, 127, 168, 81, 255, 77, 118, 117, 255] },
        { name: "filtered SRT downsampling", args: ["-define", "distort:scale=0.5", "-distort", "SRT", "0"],
            width: 3, height: 2, x: 0, y: 0, pixels: [136, 95, 141, 255, 127, 115, 142, 255, 117, 116, 146, 255, 163, 132, 82, 255, 137, 167, 100, 255, 112, 141, 145, 255] }
    ])(`matches native $name (${mode})`, async ({ args, width, height, x, y, pixels }) => {
        const output = await run(["+filter", ...args]);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(output.virtualCanvas ?? { width, height, x: 0, y: 0 }).toEqual({ width, height, x, y });
        expect(output.data).toEqual(Uint8Array.from(pixels));
    });

    it(`rounds scaled negative viewport offsets like native (${mode})`, async () => {
        const output = await run(["-define", "distort:scale=2", "-define", "distort:viewport=3x2-1-1", ...identity]);
        expect([output.width, output.height]).toEqual([6, 4]);
        expect(output.virtualCanvas).toEqual({ width: 6, height: 4, x: -1, y: -1 });
        const expected = Uint8Array.from({ length: 6 * 4 * 4 }, (_, i) => doubled.data[(Math.max(0, Math.floor(i / 24) - 1) * 12 + Math.max(0, Math.floor(i / 4) % 6 - 1)) * 4 + i % 4]!);
        expect(output.data).toEqual(expected);
    });

    it.each([
        { operator: "-distort", width: 12, height: 8, page: { width: 40, height: 32, x: 0, y: 0 } },
        { operator: "+distort", width: 16, height: 12, page: { width: 53, height: 48, x: 2, y: 4 } }
    ])(`scales existing page geometry with $operator (${mode})`, async ({ operator, width, height, page }) => {
        const output = await run(["-set", "page", "20x16+2+3", "-define", "distort:scale=2", operator, ...identity.slice(1)]);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(output.virtualCanvas).toEqual(page);
    });

    it(`retains native source dimensions when a scaled dimension rounds to zero (${mode})`, async () => {
        const output = await run(["-define", "distort:scale=0.1", ...identity]);
        expect([output.width, output.height]).toEqual([6, 4]);
    });

    it.each(["0.09", "1e100"])(`rejects unsafe scale=%s without replacing output (${mode})`, async scale => {
        await run(["-define", `distort:scale=${scale}`, ...identity], false);
    });
}
