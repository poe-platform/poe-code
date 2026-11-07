import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// Native ImageMagick: -size 5x4 xc:'#204060' -fill red -draw 'point 3,2' -repage 30x20+7+5.
const source = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAUAAAAEAQMAAAB8/WcDAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURSBAYP8AAH+GJ14AAAAQY2FOdgAAAB4AAAAUAAAABwAAAAUusbYkAAAADklEQVQI12NgAAIBBgYAADgAEXDnS+wAAAAASUVORK5CYII=", "base64");

for (const mode of ["buffered", "retained", "command"]) {
    it.each([false, true])(`scales splice canvas metadata, mode=${mode}, reset=%s`, async reset => {
        const files = new Map([["input.png", new Uint8Array(source)]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", source);
        const args = ["input.png", ...(reset ? ["+repage"] : []), "-background", "#cd23617219658000", "-splice", "2x1+2+1", "out.png"];
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
        expect([output.width, output.height]).toEqual([7, 5]);
        // Native identify: 7x5 42x25+9+6; without the custom page: 7x5 7x5+0+0.
        expect(output.virtualCanvas ?? { width: output.width, height: output.height, x: 0, y: 0 }).toEqual(reset
            ? { width: 7, height: 5, x: 0, y: 0 }
            : { width: 42, height: 25, x: 9, y: 6 });
    });
}
