import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, two identical three-pixel frames as RGB8.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["1x1+0", "000000000000000000000000000000000000"],
        ["2x1+0", "000000ffffffff0000000000ffffffff0000"],
        ["%[fx:t+1]x1+0", "000000000000000000000000ffffffff0000"],
        ["%[fx:n]x1+0", "000000ffffffff0000000000ffffffff0000"],
        ["%[fx:u[1].w-1]x1+0", "000000ffffffff0000000000ffffffff0000"],
        ["%[fx:w-1]x1+0", "000000ffffffff0000000000ffffffff0000"],
    ])(`evaluates local threshold geometry against the full image list (${mode}): %s`, async (geometry, expected) => {
        const args = ["xc:#0d3257", "xc:#7ca1c6", "xc:#eb1035", "+append", "-duplicate", "1", "-lat", geometry, "-depth", "8", "rgb:-"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(args), chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
