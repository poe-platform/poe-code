import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// Native 3x2 grayscale PNG: black first row, white second row.
const source = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAAAAAC4HznGAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAD/h4/MvwAAAAd0SU1FB+oLBxI1FDZF+jkAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTg6NTM6MjArMDA6MDAuWF0+AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE4OjUzOjIwKzAwOjAwXwXlggAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxODo1MzoyMCswMDowMAgQxF0AAAAQSURBVAjXY2BgYGD8z8AAAAMJAQEZMk96AAAAAElFTkSuQmCC", "base64");

for (const mode of ["buffered", "retained", "command"]) {
    it.each([
        { background: "#20408080", color: [32, 64, 128, 128] },
        { background: "#204080", color: [32, 64, 128, 255] },
        { background: "none", color: [0, 0, 0, 0] }
    ])(`preserves splice RGBA from grayscale input, mode=${mode}, background=$background`, async ({ background, color }) => {
        const files = new Map([["in.png", new Uint8Array(source)]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", source);
        const args = ["in.png", "-background", background, "-splice", "1x1+1+1", "out.png"];
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
        expect([output.width, output.height]).toEqual([4, 3]);
        // Native decoded RGBA; PNG palette selection is not part of the contract.
        const black = [0, 0, 0, 255], white = [255, 255, 255, 255];
        expect(Array.from(output.data)).toEqual([
            ...black, ...color, ...black, ...black,
            ...color, ...color, ...color, ...color,
            ...white, ...color, ...white, ...white
        ]);
    });
}
