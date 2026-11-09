import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// 7x6 opaque PNG48; native ImageMagick 7.1.2-35 shades the first bevel pixel #7da0c6.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAAGEAIAAADQ/M9iAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTY6NDQ6MzArMDA6MDA7RpWpAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE2OjQ0OjMwKzAwOjAwShstFQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxNjo0NDozMCswMDowMB0ODMoAAAA4SURBVBjTY2RgV3ZdfZb5BQMDAwMLflI6goGBgYElAl2CGadSTAlMcZkIHGYQ7wAszsDpAAxnAACZeiMpp+b4ZgAAAABJRU5ErkJggg==", "base64");

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it(`renders hexadecimal frame bevels like decimal bevels, ${mode}`, async () => {
        let decimal: ReturnType<typeof decodeImage> | undefined;
        for (const geometry of ["2x2+1+1", "2x2+0x1+0x1", "2x2+0X1+1", "2x2+1+0x1", "2x2+0+0"]) {
            const files = new Map([["in.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const args = ["in.png", "-mattecolor", "#4275ac", "-frame", geometry, "PNG48:out.png"];
            if (mode === "command") {
                const command = createMagickCommand(), argumentValues = createCommandArguments(args);
                const result = await command.execute({
                    command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write() {} }
                });
                expect(result.exitCode, geometry).toBe(0);
            } else {
                const result = mode === "sync" ? runConvertCliSync(args, files)
                    : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
                expect(result.exitCode, result.stderr).toBe(0);
            }
            const output = decodeImage(mode === "sync" || mode === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
            expect([output.width, output.height], geometry).toEqual([11, 10]);
            if (geometry === "2x2+0+0") {
                expect([...output.data.slice(0, 4)]).toEqual([0x42, 0x75, 0xac, 255]);
            } else {
                expect([...output.data.slice(0, 4)], geometry).toEqual([0x7d, 0xa0, 0xc6, 255]);
                decimal ??= output;
                expect(output.data, geometry).toEqual(decimal.data);
                expect(output.data16, geometry).toEqual(decimal.data16);
            }
        }
    });
}
