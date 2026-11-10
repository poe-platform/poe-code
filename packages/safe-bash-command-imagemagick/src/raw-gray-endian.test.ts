import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, 2x2 raw input followed by -append -depth 8 rgba:out.
for (const mode of ["file", "stream", "sync"] as const) {
    it.each([
        { coder: "gray", endian: "MSB", input: "093e73a8dd12477c", expected: "090909ff737373ffdcdcdcff474747ff" },
        { coder: "gray", endian: "LSB", input: "093e73a8dd12477c", expected: "3e3e3effa8a8a8ff131313ff7c7c7cff" },
        { coder: "rgb", endian: "MSB", input: "093e73a8dd12477cb1e61b5085baef24598ec3f82d6297cc", expected: "0973dcff47b11bff85ee59ffc32d97ff" },
        { coder: "gray", endian: "MSB", input: "093e73a8dd1247", expected: "4b454550" },
        { coder: "gray", endian: "LSB", input: "093e73a8dd1247", expected: "4b454550" }
    ])(`${mode}: decodes $coder $endian input $input`, async ({ coder, endian, input, expected }) => {
        const bytes = Buffer.from(input, "hex"), original = Buffer.from("KEEP");
        const argv = ["-size", "2x2", "-depth", "16", "-endian", endian, `${coder}:${mode === "stream" ? "-" : "in.raw"}`, "-append", "-depth", "8", "rgba:out"];
        const truncated = bytes.length === 7;
        let result: { exitCode: number }, stderr = "", output: Uint8Array;
        if (mode === "sync") {
            const files = new Map<string, Uint8Array>([["in.raw", bytes], ["out", original]]);
            const sync = runMagickCliSync(argv, files);
            result = sync;
            stderr = sync.stderr;
            output = files.get("out")!;
        } else {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.raw", bytes);
            await fs.writeFile("/out", original);
            const args = createCommandArguments(argv);
            result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal,
                stdin: (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
            output = await fs.readFile("/out");
        }
        expect(result.exitCode).toBe(truncated ? 1 : 0);
        if (truncated) expect(stderr).toContain("unexpected end-of-file");
        else expect(stderr).toBe("");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
