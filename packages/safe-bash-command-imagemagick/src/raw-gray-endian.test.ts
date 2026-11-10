import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, 2x2 raw input followed by -append -depth 8 rgba:out.
for (const mode of ["file", "stream", "sync"] as const) {
    it.each([
        { coder: "gray", depth: 16, endian: "MSB", input: "093e73a8dd12477c", expected: "090909ff737373ffdcdcdcff474747ff" },
        { coder: "gray", depth: 16, endian: "LSB", input: "093e73a8dd12477c", expected: "3e3e3effa8a8a8ff131313ff7c7c7cff" },
        { coder: "rgb", depth: 16, endian: "MSB", input: "093e73a8dd12477cb1e61b5085baef24598ec3f82d6297cc", expected: "0973dcff47b11bff85ee59ffc32d97ff" },
        { coder: "gray", depth: 16, endian: "MSB", input: "093e73a8dd1247", expected: "4b454550" },
        { coder: "gray", depth: 16, endian: "LSB", input: "093e73a8dd1247", expected: "4b454550" },
        ...[
            { coder: "rgb", depth: 32, input: "000000000000803e0000003f0000403f000000000000803e0000003f0000403f000000000000803e0000003f0000403f", expected: "003e3fff3f003eff3f3f00ff3e3f3fff" },
            { coder: "gray", depth: 32, input: "000000000000803e0000003f0000403f", expected: "000000ff3e3e3eff3f3f3fff3f3f3fff" },
            { coder: "rgb", depth: 16, input: "000000340038003c000000340038003c000000340038003c", expected: "003438ff3c0034ff383c00ff34383cff" },
            { coder: "gray", depth: 16, input: "000000340038003c", expected: "000000ff343434ff383838ff3c3c3cff" },
            { coder: "rgb", depth: 32, input: "000000000000803e", expected: "4b454550" },
            { coder: "gray", depth: 32, input: "000000000000803e0000003f000040", expected: "4b454550" }
        ].flatMap(fixture => [
            { ...fixture, endian: "LSB" },
            ...(fixture.expected === "4b454550" ? [] : [{ ...fixture, endian: "MSB", input: (fixture.depth === 32 ? Buffer.from(fixture.input, "hex").swap32() : Buffer.from(fixture.input, "hex").swap16()).toString("hex") }])
        ])
    ])(`${mode}: decodes $coder $depth $endian input $input`, async ({ coder, depth, endian, input, expected }) => {
        const bytes = Buffer.from(input, "hex"), original = Buffer.from("KEEP");
        const argv = ["-size", "2x2", "-depth", String(depth), "-define", "quantum:format=unsigned", "-endian", endian, `${coder}:${mode === "stream" ? "-" : "in.raw"}`, "-append", "-define", "quantum:format=unsigned", "-depth", "8", "rgba:out"];
        const truncated = expected === "4b454550";
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
