import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI: the inline source defaults to LSB, PNG defaults to MSB.
for (const mode of ["command", "sync"] as const) for (const write of [false, true]) for (const destination of ["PFM:/out", "PFM:-"]) {
    it.each([undefined, "LSB", "MSB", "Undefined"])(`${mode}, write=${write}, ${destination}: PFM endian %s`, async endian => {
        const args = ["xc:#123456789abc", "-depth", "16", ...(endian ? ["-endian", endian] : []), ...(write ? ["-write", destination, "null:"] : [destination])];
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const stdout: Uint8Array[] = [];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = Buffer.from(destination === "PFM:-" ? "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout) : mode === "sync" ? files.get("/out")! : await fs.readFile("/out"));
        const little = endian === undefined || endian === "LSB";
        const expected = Buffer.concat([Buffer.from(`PF\n1 1\n${little ? "-1.0" : "1.0"}\n`), Buffer.from(little ? "92a0913dadf0ac3e9bbc1a3f" : "3d91a0923eacf0ad3f1abc9b", "hex")]);
        expect(output).toEqual(expected);
    });
}
