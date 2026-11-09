import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAIAAAAG+GGPAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjI6MDA6NDkrMDA6MDCh8UXWAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIyOjAwOjQ5KzAwOjAw0Kz9agAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMjowMToxNSswMDowMOc705sAAAAmSURBVAjXY2SV5xfXF0ZDjMsypmARdd8oiUX0xa95WEQ7nZUxRQGTHBDJkVj39QAAAABJRU5ErkJggg==", "base64");

// Native ImageMagick 7: active regions leave inserted columns black, while
// inserted rows retain the background color, including their intersections.
for (const mode of ["buffered", "retained", "command"]) {
    it.each([
        { region: ["-region", "4x3+1+1"], background: "white", color: [255, 255, 255, 255] },
        { region: ["-region", "7x5+0+0"], background: "red", color: [255, 0, 0, 255] },
        { region: ["-region", "1x1+2+2"], background: "white", color: [255, 255, 255, 255] },
        { region: ["-region", "4x3+1+1", "+region"], background: "white", color: [255, 255, 255, 255] },
        { region: [], background: "red", color: [255, 0, 0, 255] },
    ])(`matches native splice insertion colors in ${mode}: $region $background`, async ({ region, background, color }) => {
        const files = new Map<string, Uint8Array>([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-background", background, ...region, "-splice", "2x1+1+1", "+region", "PNG32:out.png"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            expect(await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })).toMatchObject({ exitCode: 0 });
        } else {
            expect(await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stderr: "" });
        }
        const output = decodeImage(mode === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
        expect([output.width, output.height]).toEqual([9, 6]);
        const original = decodeImage(input), expected = [];
        for (let y = 0; y < 6; y++) for (let x = 0; x < 9; x++) {
            const offset = ((y < 1 ? y : y - 1) * 7 + (x < 1 ? x : x - 2)) * 4;
            expected.push(...(y === 1 ? color : x === 1 || x === 2
                ? region.length === 2 ? [0, 0, 0, 255] : color
                : original.data.subarray(offset, offset + 4)));
        }
        expect([...output.data]).toEqual(expected);
    });
}
