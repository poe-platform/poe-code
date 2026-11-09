import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// Native ImageMagick RGBA16 input; low bits differ from the 8-bit samples.
const input16 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADEAYAAADkZHKFAAAAJklEQVQI12Pk4hYRlZMPCBQS4uVlZ+fmRqdZPDxMTGRkdHTIVgAAk6YHqN3DPjUAAAAASUVORK5CYII=", "base64");

for (const depth of [8, 16]) for (const mode of ["buffered", "retained", "command"]) {
    for (const offset of [6, 4, -2]) {
        it.each(["tile", "transparent", "mirror", "edge", "background", "black", "white", "gray"])(`${mode}, depth ${depth}: splice offset ${offset} uses %s virtual pixels`, async method => {
            const pixels = Uint8Array.from(Array.from({ length: 12 }, (_, i) => [10 + i * 18, 20 + i * 13, 30 + i * 7, 80 + i * 11]).flat());
            const bytes = depth === 16 ? input16 : await sharp(pixels, { raw: { width: 4, height: 3, channels: 4 } }).png().toBuffer();
            const files = new Map([["input.png", bytes]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", bytes);
            const args = ["input.png", "-background", "#ff00ff", "-virtual-pixel", method, "-splice", `2x0${offset >= 0 ? "+" : ""}${offset}+0`, `PNG${depth === 16 ? 64 : 32}:out.png`];
            if (mode === "command") {
                const command = createMagickCommand(), argumentValues = createCommandArguments(args);
                const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
                expect(result.exitCode).toBe(0);
            } else {
                expect((await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" })).exitCode).toBe(0);
            }
            const output = decodeImage(mode === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
            expect([output.width, output.height]).toEqual([6, 3]);
            const expected: number[] = [];
            const source = depth === 16 ? Array.from(pixels, value => value * 257 + 1) : Array.from(pixels);
            const scale = depth === 16 ? 257 : 1;
            for (let y = 0; y < 3; y++) for (let x = 0; x < 6; x++) {
                if (x < 4) expected.push(...source.slice((y * 4 + x) * 4, (y * 4 + x + 1) * 4));
                else if (offset === 4 || method === "background") expected.push(255 * scale, 0, 255 * scale, 255 * scale);
                else if (method === "transparent") expected.push(0, 0, 0, 0);
                else if (["black", "white", "gray"].includes(method)) {
                    const value = method === "white" ? 255 : method === "gray" ? 128 : 0;
                    expected.push(value * scale, value * scale, value * scale, 255 * scale);
                } else {
                    const sourceX = method === "tile" ? x - 4 : method === "mirror" ? 7 - x : 3;
                    expected.push(...source.slice((y * 4 + sourceX) * 4, (y * 4 + sourceX + 1) * 4));
                }
            }
            expect(Array.from(depth === 16 ? output.data16! : output.data)).toEqual(expected);
        });
    }
}
