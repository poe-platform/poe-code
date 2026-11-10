import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { fill: "#aaab567889ab", draw: "point 1,0", expected: "2345567889abffffaaab567889abffff" },
        { fill: "red", draw: "point 1,0", expected: "2345567889abffffffff00000000ffff" },
        { fill: "#aaab567889ab", draw: "rectangle 1,0 1,0", expected: "2345567889abffffaaab567889abffff" },
        { fill: "#aaab567889ab", draw: "", expected: "2345567889abffff2345567889abffff" },
        { fill: "none", draw: "point 1,0", expected: "2345567889abffff2345567889abffff" },
    ])(`${mode}: preserves 16-bit samples with $fill and '$draw'`, async ({ fill, draw, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["-size", "2x1", "xc:#2345567889ab", "-fill", fill,
            ...(draw ? ["-draw", draw] : []), "-depth", "16", "-endian", "MSB", "rgba:out.rgba"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, JSON.stringify(result) + stderr).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.rgba") : files.get("out.rgba")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
