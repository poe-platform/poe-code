import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255], white = [255, 255, 255, 255];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    // Native ImageMagick 7.1.2-35: whitespace around a range dash is not a list separator.
    it.each([
        { operation: "-delete", spec: "2 -3", pixels: [red, green] },
        { operation: "-clone", spec: "2 - 3", pixels: [red, green, blue, white, blue, white] },
        { operation: "-duplicate", spec: "1,2- 3", pixels: [red, green, blue, white, blue, white] },
        { operation: "-clone", spec: "2 3", pixels: [red, green, blue, white, blue, white] },
        { operation: "-clone", spec: "2-3", pixels: [red, green, blue, white, blue, white] },
        { operation: "-clone", spec: "2\t-\n3", pixels: [red, green, blue, white, blue, white] },
        { operation: "-clone", spec: "-2 - -1", pixels: [red, green, blue, white, blue, white] },
        { operation: "-clone", spec: "3 - 2", pixels: [red, green, blue, white, white, blue] },
        { operation: "-clone", spec: "2 - 3 0", pixels: [red, green, blue, white, blue, white, red] },
        { operation: "-clone", spec: "2, -1", pixels: [red, green, blue, white, blue, white] }
    ])(`${mode}: $operation '$spec' preserves frame order`, async ({ operation, spec, pixels }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:red", "xc:lime", "xc:blue", "xc:white", operation, spec, "+append", "PNG24:out.png"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        }
        const output = decodeImage(mode === "command" || mode === "retained"
            ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([pixels.length, 1]);
        expect([...output.data]).toEqual(pixels.flat());
    });
}
