import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// Native magick -size 5x4 xc:'#412352347345' -fill '#400150016001'
// -draw 'point 3,2' -depth 16 PNG48:-
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAUAAAAEEAIAAACZwb5UAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAHdElNRQfqCwcPAiMKAc8hAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDE1OjAyOjM1KzAwOjAwaXPVBQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QxNTowMjozNSswMDowMBgubbkAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTU6MDI6MzUrMDA6MDBPO0xmAAAAKElEQVQI12N0VA4yKXZlwAGYGPACLNL/7/07+3YPTmlGJSZjYRcIGwCkmAeqCcl6JQAAAABJRU5ErkJggg==", "base64");

for (const mode of ["buffered", "retained", "command"]) {
    it.each([
        { geometry: "1x1+0+0", cw: 1, ch: 1, cx: 0, cy: 0 },
        { geometry: "1x1+1+1", cw: 1, ch: 1, cx: 1, cy: 1 },
        { geometry: "1x0+1+0", cw: 1, ch: 0, cx: 1, cy: 0 },
        { geometry: "0x1+0+1", cw: 0, ch: 1, cx: 0, cy: 1 }
    ])("preserves every saved 16-bit chop sample, mode=" + mode + ", geometry=$geometry", async ({ geometry, cw, ch, cx, cy }) => {
        const files = new Map<string, Uint8Array>([["in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["in.png", "-background", "red", "-chop", geometry, "out.png"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
        } else {
            expect((await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" })).exitCode).toBe(0);
        }
        const bytes = mode === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png");
        expect(bytes[24]).toBe(16);
        const image = decodeImage(bytes);
        expect([image.width, image.height]).toEqual([5 - cw, 4 - ch]);
        const expected: number[] = [];
        for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
            const sourceX = x < cx ? x : x + cw, sourceY = y < cy ? y : y + ch;
            expected.push(...(sourceX === 3 && sourceY === 2 ? [0x4001, 0x5001, 0x6001, 65535] : [0x4123, 0x5234, 0x7345, 65535]));
        }
        expect(Array.from(image.data16!)).toEqual(expected);
    });
}
