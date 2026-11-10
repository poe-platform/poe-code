import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const colors = { R: [255, 0, 0], G: [0, 255, 0], B: [0, 0, 255], W: [255, 255, 255] };

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    // ImageMagick 7.1.2-35 stops deleting at a missing range endpoint.
    it.each([
        { spec: "0-", order: "RGBW" },
        { spec: "1-", order: "RGBW" },
        { spec: "2-", order: "RGBW" },
        { spec: "-2-", order: "RGBW" },
        { spec: "1-,3", order: "RGBW" },
        { spec: "3,1-", order: "RGB" },
        { spec: "1- ,3", order: "RGBW" },
        { spec: "1-,bad", order: "" },
        { spec: "0-0", order: "GBW" },
        { spec: "2-0", order: "RGBW" },
        { spec: "bad", order: "" },
    ])(`${mode}: -delete '$spec' matches native status and raw RGB output`, async ({ spec, order }) => {
        const args = ["xc:red", "xc:lime", "xc:blue", "xc:white", "-delete", spec, "+append", "-depth", "8", "rgb:-"];
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        let stdout: number[] = [];
        let exitCode: number;
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({
                command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(...bytes); } },
                stderr: { async write() {} },
            });
            exitCode = result.exitCode;
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            exitCode = result.exitCode;
            expect(result.stdout).toBe("");
            stdout = [...result.stdoutBytes ?? []];
        }
        expect(exitCode).toBe(order ? 0 : 1);
        expect(stdout).toEqual([...order].flatMap(color => colors[color as keyof typeof colors]));
    });
}
