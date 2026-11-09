import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAIAAAAr0DSeAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTU6MzY6NDUrMDA6MDDzvxpnAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE1OjM2OjQ1KzAwOjAwguKi2wAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxNTozNjo0NSswMDowMNX3gwQAAAAVSURBVAjXY2BkMnAoaJiwYMOBCw8AGU8FtFQs7YcAAAAASUVORK5CYII=", "base64");
const first = [0x0102, 0x3040, 0x7080, 65535];
const second = [0x90a0, 0xb0c0, 0xd0e0, 65535];

// Padding samples from ImageMagick 7.1.2-35, Q16 PNG48 output.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const operation of ["-splice", "-extent"] as const) {
        it.each([
            ["black", [0, 0, 0, 65535]],
            ["#123456", [0x1212, 0x3434, 0x5656, 65535]],
            ["#123456789abc", [0x1234, 0x5678, 0x9abc, 65535]],
            ["rgb(50%,25%,75%)", [0x8000, 0x4000, 0xbfff, 65535]],
        ] as const)(`preserves 16-bit padding and source pixels for ${operation} %s (${mode})`, async (background, color) => {
            const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const args = ["in.png", "-background", background, operation, operation === "-splice" ? "1x0+1+0" : "3x1", "-depth", "16", "PNG48:out.png"];
            let stderr = "";
            const argumentValues = createCommandArguments(args);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, stderr).toBe(0);
            const bytes = mode === "retained" || mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!;
            expect(bytes[24]).toBe(16);
            const output = decodeImage(bytes);
            expect([output.width, output.height]).toEqual([3, 1]);
            expect(Array.from(output.data16!)).toEqual(operation === "-splice"
                ? [...first, ...color, ...second] : [...first, ...second, ...color]);
        });
    }
}
