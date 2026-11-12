import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: background/source/background bytes.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: "Off", background: "#20402040", extract: false, expected: "204020404080c0ff20402040" },
        { alpha: "Off", background: "none", extract: false, expected: "000000004080c0ff00000000" },
        { alpha: "Off", background: "#20402040", extract: true, expected: "40ff40" },
        { alpha: "On", background: "#20402040", extract: false, expected: "204020404080c08020402040" },
        { alpha: "Off", background: "white", extract: false, expected: "ffffffff4080c0ffffffffff" }
    ])(`${mode}: wave alpha $alpha, background $background, extract $extract`, async ({ alpha, background, extract, expected }) => {
        const argv = ["xc:#4080c080", "-alpha", alpha, "-background", background,
            "-interpolate", "Nearest", "-wave", "1x4", ...(extract ? ["-alpha", "extract"] : []),
            "-depth", "8", extract ? "gray:-" : "rgba:-"];
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
