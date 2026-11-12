import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference pixels, RGBA16 big-endian.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { first: "Gray", second: "sRGB", selected: 0, expected: "96406a6a1edf9bdb" },
        { first: "Gray", second: "sRGB", selected: 1, expected: "9640000000000000" },
        { first: "sRGB", second: "CMYK", selected: 0, expected: "c3c3886154189bdb" },
        { first: "sRGB", second: "CMYK", selected: 1, expected: "fa39ffffffff0000" },
        { first: "CMYK", second: "sRGB", selected: 0, expected: "4842ffffffff0000" },
    ])(`${mode}: poly $first/$second with Red selected on source $selected`, async ({ first, second, selected, expected }) => {
        const argv = ["xc:#173e5970", "xc:#b56829cf"].flatMap((input, index) => [
            "(", input, "-colorspace", index === 0 ? first : second,
            ...(index === selected ? ["-channel", "Red"] : []), ")",
        ]);
        argv.push("-poly", "0.25,1,0.75,1", "+channel", "-colorspace", "sRGB",
            "-depth", "16", "-endian", "MSB", "rgba:-");
        const fs = new MemoryFileSystem(), stdout: Uint8Array[] = [];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
