import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255], white = [255, 255, 255, 255];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    // Reference: ImageMagick 7.1.2-35, decoded PNG24 pixels and exit status.
    it.each([
        { spec: "1,", pixels: [red, green, blue, white] },
        { spec: "1", pixels: [red, green, blue, white, white] },
        { spec: "1,,", pixels: [red, green, blue, white, red] },
        { spec: "1,,2", pixels: [red, green, blue, white, blue] },
        { spec: "1,2", pixels: [red, green, blue, white, blue] }
    ])(`${mode}: -duplicate '$spec' preserves the selected frames`, async ({ spec, pixels }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:red", "xc:lime", "xc:blue", "xc:white", "-duplicate", spec, "+append", "PNG24:out.png"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const stderr: unknown[] = [];
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(chunk) { stderr.push(chunk); } } });
            expect(result.exitCode).toBe(0);
            expect(stderr).toEqual([]);
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
