import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const red = [255, 0, 0], green = [0, 255, 0], blue = [0, 0, 255], white = [255, 255, 255];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    // Native ImageMagick 7.1.2-35 treats an omitted range endpoint as frame zero.
    it.each([
        { operation: "-clone", spec: "2-", pixels: [red, green, blue, white, blue, green, red] },
        { operation: "-clone", spec: "0-", pixels: [red, green, blue, white, red] },
        { operation: "-clone", spec: "-2-", pixels: [red, green, blue, white, blue, green, red] },
        { operation: "-clone", spec: "1-,3", pixels: [red, green, blue, white, green, red, white] },
        { operation: "-clone", spec: "2-0", pixels: [red, green, blue, white, blue, green, red] },
        { operation: "-clone", spec: "bad", pixels: null },
        { operation: "-duplicate", spec: "1,2-", pixels: [red, green, blue, white, blue, green, red] },
        { operation: "-duplicate", spec: "1,2-0", pixels: [red, green, blue, white, blue, green, red] },
        { operation: "-clone", spec: "2-bad", pixels: null },
        { operation: "-duplicate", spec: "1,2-bad", pixels: null }
    ])(`${mode}: $operation '$spec' matches native scene selection`, async ({ operation, spec, pixels }) => {
        const filesystem = new MemoryFileSystem();
        const args = ["xc:red", "xc:lime", "xc:blue", "xc:white", operation, spec, "+append", "-depth", "8", "rgb:-"];
        let exitCode: number;
        let output: number[];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            output = [];
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write(bytes) { output.push(...bytes); } }, stderr: { async write() {} } });
            exitCode = result.exitCode;
        } else {
            const files = new Map<string, Uint8Array>();
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            exitCode = result.exitCode;
            output = [...(result.stdoutBytes ?? [])];
        }
        expect(exitCode).toBe(pixels === null ? 1 : 0);
        expect(output).toEqual(pixels?.flat() ?? []);
    });
}
