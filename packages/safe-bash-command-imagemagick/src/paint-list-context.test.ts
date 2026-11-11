import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete RGB8 output from ImageMagick 7.1.2-35 Q16-HDRI with identical argv.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { radius: "1", expected: "0000ffff00000080000000ffff0000008000" },
        { radius: "2", expected: "0080000000ffff00000080000000ffff0000" },
        { radius: "%[fx:w-1]", expected: "0080000000ffff00000080000000ffff0000" },
        { radius: "%[fx:n]", expected: "0080000000ffff00000080000000ffff0000" },
        { radius: "%[fx:t+1]", expected: "0000ffff00000080000080000000ffff0000" },
        { radius: "%[fx:u[1].w-1]", expected: "0080000000ffff00000080000000ffff0000" },
    ])(`${mode}: expands paint radius $radius against the image list`, async ({ radius, expected }) => {
        const fs = new MemoryFileSystem();
        const args = ["xc:red", "xc:green", "xc:blue", "+append", "-duplicate", "1",
            "-virtual-pixel", "tile", "-paint", radius, "-depth", "8", "rgb:-"];
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) stdout.push(result.stdoutBytes);
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(Buffer.concat(stdout).toString("hex")).toBe(expected);
    });
}
