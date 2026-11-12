import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const north = ["-define", "trim:edges=north"];
const info = ["-format", "%wx%h%O", "info:"];
const gray = ["-depth", "8", "gray:-"];
const pixels = "ffff363636ffffffff363636ffffffffffffffffffffffffffffffff";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "defined edges", args: [...north, "-crop", "%@", ...info], expected: "7x4+0+1" },
        { name: "later edge reset", args: [...north, "-crop", "%@", "+define", "trim:edges", ...info], expected: "7x4+0+1" },
        { name: "option edges", args: ["-set", "option:trim:edges", "north", "-crop", "%@", ...info], expected: "7x4+0+1" },
        { name: "percentage background", args: ["-fill", "#eeeeee", "-draw", "point 1,3", "-define", "trim:percent-background=50", "-crop", "%@", ...info], expected: "3x2+2+1" },
        { name: "edge pixels", args: [...north, "-crop", "%@", ...gray], expected: pixels, binary: true },
        { name: "literal geometry pixels", args: [...north, "-crop", "8x5+0+1", ...gray], expected: pixels, binary: true },
        { name: "formatted bounds", args: [...north, "-format", "%@;%[bounding-box]\n", "info:"], expected: "8x5+0+1;0,1 8,6\n" },
        { name: "trim control", args: [...north, "-trim", ...info], expected: "7x4+0+1" },
        { name: "default crop", args: ["-crop", "%@", ...info], expected: "3x2+2+1" },
    ])(`honors trim settings for $name (${mode})`, async ({ args, expected, binary }) => {
        const filesystem = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argv = ["-size", "7x5", "xc:white", "-fill", "red", "-draw", "rectangle 2,1 4,2", ...args];
        let result;
        if (mode === "command") {
            let stdout = "", stderr = "";
            const status = await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += binary ? Buffer.from(bytes).toString("hex") : new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            result = { ...status, stdout, stderr };
        } else {
            result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            if (binary) result = { exitCode: result.exitCode, stderr: result.stderr, stdout: Buffer.from(result.stdoutBytes!).toString("hex") };
        }
        expect(result).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
