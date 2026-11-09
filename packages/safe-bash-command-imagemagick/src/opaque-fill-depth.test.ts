import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: only pixel 0 matches #27104e207530ffff.
// Pixel 1 differs by one red quantum; +opaque paints the other seven pixels.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAABEAYAAACzkDMAAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTk6NDI6NDErMDA6MDC9mjJ2AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE5OjQyOjQxKzAwOjAwzMeKygAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxOTo0Mjo0MSswMDowMJvSqxUAAAA8SURBVAjXY1QX8FMoNfj/n4GRAQKYoPRfBgYGBob/EA4jk7rAzQ/qAgwMNz+oC9z80MDAwMDIyMBQ/x8Ac9kNTDbfFR0AAAAASUVORK5CYII=", "base64");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operator of ["-opaque", "+opaque"]) {
        for (const [fill, paint] of [
            ["#abcd1234ef019876", [0xabcd, 0x1234, 0xef01, 0x9876]],
            ["#abab1212eeee9898", [0xabab, 0x1212, 0xeeee, 0x9898]]
        ] as const) {
            it(`${mode}: ${operator} preserves full replacement RGBA for ${fill}`, async () => {
                const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.png", input);
                const argv = ["in.png", "-fill", fill, operator, "#27104e207530ffff", "PNG64:out.png"];
                const args = createCommandArguments(argv);
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write() {} }
                }) : mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                const expected = decodeImage(input).data16!;
                expect([...expected.slice(0, 8)]).toEqual([10000, 20000, 30000, 65535, 10001, 20000, 30000, 65535]);
                for (let pixel = 0; pixel < 8; pixel++) {
                    if (operator === "-opaque" ? pixel === 0 : pixel !== 0) expected.set(paint, pixel * 4);
                }
                const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
                expect(output[24]).toBe(16);
                expect([...decodeImage(output).data16!]).toEqual([...expected]);
            });
        }
    }
}

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it(`${mode}: still rounds precise fill colors in byte-only floodfill`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["-size", "1x1", "xc:white", "-fill", "#abcd1234ef019876", "-floodfill", "+0+0", "white", "PNG32:out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual([171, 18, 238, 152]);
    });
}
