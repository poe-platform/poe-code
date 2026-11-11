import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: full RGB rasters and geometry, including page offsets.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["7x9-1+2", "30", "8", "4x4|14x18-2+1", "ffffffffe2ddfffdfdfffffff6fdffba145aff150affe2dfdfe2ff0a15ff5a15bafffdf6fffffffdfdffdde2ffffffff"],
        ["7x9-1+2", "60", "8", "4x4|14x18-2+1", "fffffffffdf6ffe2dfffffffdde2ff5a15baff150afffdfdfdfdff0a14ffba145affe2ddffffffdfe2fff6fdffffffff"],
        ["7x9-1+2", "90.000001", "16", "4x4|14x18-2+1", "ffffffffffffefa4f7b1fffffffff7f0efe4fffffffffffff7f0f7f0ffff105d0850f7f2f7b10850109dfffff7b1f7b1f7b1f7b1ffff109d0850f7b1f7f20850105dfffff7f0f7f0ffffffffffffefe4f7f0fffffffff7b1efa4ffffffffffff"],
        ["7x9-1+2", "90", "16", "2x2|9x7+5-1", "00000000ffffffff0000000000000000ffffffff00000000"],
        ["7x9+0+0", "30", "8", "4x4|14x18-1-1", "ffffffffe2ddfffdfdfffffff6fdffba155aff150affe2dfdfe2ff0a15ff5a15bafffdf6fffffffdfdffdde2ffffffff"],
        ["7x9+0+0", "60", "8", "4x4|14x18-1-1", "fffffffffdf6ffe2dfffffffdde2ff5a14baff140afffdfdfdfdff0a14ffba1559ffe2ddffffffdfe2fff6fdffffffff"],
    ])(`matches native rotation samples for %s at %s degrees, depth %s (${mode})`, async (page, angle, depth, geometry, pixels) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "2x2", "gradient:red-blue", "-repage", page, "-rotate", angle,
            "-depth", depth, "-endian", "MSB", "-write", "rgb:/out", "-format", "%wx%h|%g", "info:"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? {
            ...await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }), stdout, stderr,
        } : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: geometry, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(pixels);
    });
}
