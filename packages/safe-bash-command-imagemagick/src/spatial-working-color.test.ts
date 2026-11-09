import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAYAAAD+Bd/7AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjM6MDQ6NTgrMDA6MDAfUTcDAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIzOjA0OjU4KzAwOjAwbgyPvwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMzowNDo1OCswMDowMDkZrmAAAAAQY2FOdgAAABkAAAAT////+/////2qATKzAAAAMklEQVQI12NmUPXKX7rj1N0fXLLrT919zyS7/tCV90wiyw9def5TZPnOM0waBMBgUAAAycsrGr6PfHgAAAAASUVORK5CYII=", "base64");
const operations = [
    ["-splice", "3x2+2+1"], ["-chop", "1x1+2+1"], ["-roll", "+1+1"],
    ["-virtual-pixel", "tile", "-splice", "3x0+12+0"],
    ["-virtual-pixel", "background", "-splice", "3x0+12+0"],
];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const depth of [8, 16]) {
        for (const explicit of [false, true]) {
            it.each([
                { space: "HSL", background: [39581, 31865, 34770, 32896] },
                { space: "HSB", background: [35723, 31100, 32840, 32896] },
                { space: "XYZ", background: [65535, 0, 65535, 32896] },
                { space: "YCbCr", background: [65535, 65535, 18387, 32896] },
            ].flatMap(entry => operations.map(operation => ({ ...entry, operation }))))(`keeps every working-color sample aligned: $space $operation, ${mode}, depth ${depth}, explicit ${explicit}`, async ({ space, background, operation }) => {
                const source = decodeImage(input);
                // Non-byte-aligned color and alpha values expose loss of the working plane's precision.
                const data16 = Uint16Array.from(source.data, (value, i) => Math.min(65535, value * 257 + i % 251));
                const bytes = depth === 8 ? input : encodeImage({ ...source, data16, depth: "ushort" }, { format: "png" }).data;
                const files = new Map<string, Uint8Array>([["in.png", bytes]]), filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/in.png", bytes);
                const run = async (args: string[]) => {
                    let stderr = "";
                    const result = mode === "command" ? await createMagickCommand().execute({
                        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                        stdin: (async function* () {})(), signal: new AbortController().signal,
                        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                    }) : mode === "sync" ? runMagickCliSync(args, files)
                        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                    expect(result.exitCode).toBe(0);
                    expect("stderr" in result ? result.stderr : stderr).toBe("");
                };
                const read = async (path: string) => decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile(`/${path}`) : files.get(path)!);
                const coder = depth === 8 ? "PNG32:" : "PNG64:";
                // Color conversion is independent of position: moving before or after it must agree.
                // Standard inverse color transforms of working-space #ef218b80, quantized to Q16.
                const color = "#" + Array.from(background, value => value.toString(16).padStart(4, "0")).join("");
                await run(["in.png", "-colorspace", space, "-colorspace", "sRGB", "-background", color, ...operation, `${coder}expected.png`]);
                await run(["in.png", "-colorspace", space, "-background", "#ef218b80", ...operation, ...(explicit ? ["-colorspace", "sRGB"] : []), `${coder}out.png`]);
                const expected = await read("expected.png"), output = await read("out.png");
                expect([output.width, output.height, output.virtualCanvas], operation.join(" ")).toEqual([expected.width, expected.height, expected.virtualCanvas]);
                expect(depth === 8 ? output.data : output.data16, operation.join(" ")).toEqual(depth === 8 ? expected.data : expected.data16);
                if (space === "HSL" && depth === 8 && operation[0] === "-splice") {
                    // ImageMagick 7.1.2-35 Q16-HDRI reference, including its virtual page.
                    expect(Array.from(output.data.subarray(8, 12))).toEqual([154, 124, 135, 128]);
                    expect(output.virtualCanvas).toEqual({ width: 34, height: 25, x: -7, y: -4 });
                }
            });
        }
    }
}
