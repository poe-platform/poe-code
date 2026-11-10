import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: a full scanline starts the next frame.
const cases = [
    { coder: "rgb", input: "093e73a8dd12477cb1e61b5085baef24598e", output: "4b454550", exitCode: 1 },
    { coder: "rgb", input: "093e73a8dd12477cb1e61b5085baef2459", output: "093e73ffa8dd12ff477cb1ffe61b50ff", exitCode: 0 },
    { coder: "gray", input: "093e73a8dd12", output: "4b454550", exitCode: 1 },
    { coder: "gray", input: "093e73a8dd", output: "090909ff3e3e3eff737373ffa8a8a8ff", exitCode: 0 },
    { coder: "gray", input: "093e73a8dd12477c", output: "090909ff3e3e3eff737373ffa8a8a8ffddddddff121212ff474747ff7c7c7cff", exitCode: 0 }
];

for (const mode of ["file", "stream", "sync"] as const) {
    it.each(cases)(`${mode} handles the later $coder frame in $input`, async ({ coder, input, output, exitCode }) => {
        const bytes = Buffer.from(input, "hex"), keep = new TextEncoder().encode("KEEP");
        const argv = ["-size", "2x2", "-depth", "8", `${coder}:${mode === "stream" ? "-" : "/raw.bin"}`, "-append", "-depth", "8", "rgba:/out"];
        let result: { exitCode: number }, stderr: string, actual: Uint8Array;
        if (mode === "sync") {
            const files = new Map<string, Uint8Array>([["/raw.bin", bytes], ["/out", keep]]);
            const sync = runMagickCliSync(argv, files);
            result = sync;
            stderr = sync.stderr;
            actual = files.get("/out")!;
        } else {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/raw.bin", bytes);
            await fs.writeFile("/out", keep);
            const args = createCommandArguments(argv);
            stderr = "";
            result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal,
                stdin: (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
            actual = await fs.readFile("/out");
        }
        expect(result.exitCode).toBe(exitCode);
        expect(Buffer.from(actual).toString("hex")).toBe(output);
        if (exitCode) expect(stderr).toContain(`unexpected end-of-file in ${coder.toUpperCase()} input`);
        else expect(stderr).toBe("");
    });
}
