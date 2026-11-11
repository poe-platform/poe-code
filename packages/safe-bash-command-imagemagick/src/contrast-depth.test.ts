import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35, PNG48 input with gray samples 6464, 6465, 6474 (hex).
const fixture = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABEAIAAADEEl+gAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTY6MTE6NTMrMDA6MDBbv+G1AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE2OjExOjUzKzAwOjAwKuJZCQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxNjoxMTo1MyswMDowMH33eNYAAAAbSURBVAjXY0xJSUlJSWFgZGBkYGTgZ+Bn4AcAJRwCis/AoucAAAAASUVORK5CYII=", "base64");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const alpha of [false, true]) {
        it.each([
            ["copy", [], [0x6464, 0x6465, 0x6474]],
            ["increase", ["-contrast"], [0x5ced, 0x5cee, 0x5d00]],
            ["decrease", ["+contrast"], [0x6bdb, 0x6bdc, 0x6be8]]
        ] as const)(`${mode}: preserves distinct 16-bit samples for %s (alpha=${alpha})`, async (_name, options, expected) => {
            const alphas = alpha ? [0x4321, 0x9876, 0xabcd] : [65535, 65535, 65535];
            const samples = [0x6464, 0x6465, 0x6474].flatMap((value, index) => [value, value, value, alphas[index]!]);
            const input = alpha ? encodeImage({ width: 3, height: 1,
                data: Uint8Array.from(samples, value => Math.round(value / 257)),
                data16: Uint16Array.from(samples), format: "png", space: "srgb",
                channels: 4, depth: "ushort", density: 72, hasAlpha: true
            }, { format: "png" }).data : fixture;
            const files = new Map<string, Uint8Array>([["in.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const argv = ["in.png", ...options, "-depth", "16", `${alpha ? "PNG64" : "PNG48"}:out.png`];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? {
                ...await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }), stderr
            } : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            const option = options[0];
            expect(result).toMatchObject({ exitCode: 0, stderr: option ? `magick: option has been replaced '${option}', use "${option[0]}level" at CLI arg 2\n` : "" });
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
            expect(output[24]).toBe(16);
            expect([...decodeImage(output).data16!]).toEqual(expected.flatMap((value, index) => [value, value, value, alphas[index]!]));
        });
    }
}
