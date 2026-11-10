import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    // Native ImageMagick 7.1.2-35 Q16-HDRI, complete 8-bit RGBA output.
    it.each([
        ...["3x1", "3,1", "3/1", "3:1", "3x1+0+0", "3x1+0+50000", "3x1!", "3x", "3x1+", "6:2"].map(geometry => [geometry, "00ffff00ff0000ffffffffff"]),
        ["2.9x1", "00000000ff0000ffffffffff"],
        ["2x1", "00000000ff0000ffffffffff"],
        ["x1", "20709040804020a0a070a0ee"],
        ["3x1+65535+0", "000000000000000000000000"],
        ["3x1+100%", "000000000000000000000000"],
        ["3x1-65535+0", "ffffffffffffffffffffffff"],
        ["3x1-100%", "ffffffffffffffffffffffff"],
        ...["", "bad", "3x1+NaN", "3x1+0+bad", "3x1x2", "1001x1", "1x1001"].map(geometry => [geometry, "4b454550"]),
    ])(`matches native window geometry %s via ${mode}`, async (geometry, expected) => {
        const sentinel = new TextEncoder().encode("KEEP"), files = new Map([["out", sentinel]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", sentinel);
        const args = ["xc:#20709040", "xc:#804020a0", "xc:#a070a0ee", "+append", "-set", "option:win", "3x1", "-lat", geometry!, "-depth", "8", "rgba:out"];
        const exitCode = expected === "4b454550" ? 1 : 0;
        if (mode === "command") {
            const argumentValues = createCommandArguments(args);
            const context = {
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, fs: filesystem,
            };
            expect(await createMagickCommand().execute(context)).toMatchObject({ exitCode });
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode, result.stderr).toBe(exitCode);
            if (exitCode === 0) expect(result.stderr).toBe("");
        }
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
