import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255], white = [255, 255, 255, 255];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const existing of [false, true]) {
        // Native ImageMagick 7.1.2-35 rejects starts before the first frame, but clips range ends.
        it.each([
            { operation: "-clone", spec: "-5--1", pixels: null },
            { operation: "-duplicate", spec: "1,-5-0", pixels: null },
            { operation: "-clone", spec: "-4--2", pixels: [red, green, blue, white, red, green, blue] },
            { operation: "-clone", spec: "0-9", pixels: [red, green, blue, white, red, green, blue, white] }
        ])(`${mode}, existing output ${existing}: $operation $spec`, async ({ operation, spec, pixels }) => {
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            let original: Uint8Array | undefined;
            if (existing) {
                expect(runMagickCliSync(["-size", "1x1", "xc:black", "PNG24:out.png"], files).exitCode).toBe(0);
                original = files.get("out.png")!;
                await filesystem.writeFile("/out.png", original);
            }
            const args = ["-size", "1x1", "xc:red", "xc:lime", "xc:blue", "xc:white", operation, spec, "+append", "PNG24:out.png"];
            let exitCode: number;
            if (mode === "command") {
                const command = createMagickCommand(), argumentValues = createCommandArguments(args);
                const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
                exitCode = result.exitCode;
            } else {
                const result = mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                exitCode = result.exitCode;
            }
            expect(exitCode).toBe(pixels === null ? 1 : 0);
            const usesFilesystem = mode === "command" || mode === "retained";
            if (pixels === null && !existing) {
                if (usesFilesystem) await expect(filesystem.readFile("/out.png")).rejects.toThrow();
                else expect(files.has("out.png")).toBe(false);
                return;
            }
            const bytes = usesFilesystem ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            if (pixels === null) expect(bytes).toEqual(original);
            const expected = pixels ?? [[0, 0, 0, 255]];
            const output = decodeImage(bytes);
            expect([output.width, output.height]).toEqual([expected.length, 1]);
            expect([...output.data]).toEqual(expected.flat());
        });
    }
}
