import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

const input = Buffer.from("404c8a96bf1d75ff5500a497955bc75a", "hex");
const expected = "5b5a00ffa5a425ff0e0f8efff0f1ffff330000ffca8c4cffbf2181ffbe2080ff";

for (const mode of ["file", "stream", "sync"] as const) {
    for (const coder of ["uyvy", "pal"]) {
        it.each([
            { name: "explicit coder", size: "4x2", bytes: input, pixels: expected, depth: ["-depth", "8"] },
            { name: "chunk boundaries", size: "4x1024", bytes: Buffer.concat(Array(512).fill(input)), pixels: expected.repeat(512), depth: [] },
            { name: "odd width", size: "3x2", bytes: input, pixels: expected, depth: [] },
            { name: "trailing frame", size: "4x2", bytes: Buffer.concat([input, input]), pixels: expected, depth: [] },
            { name: "short input", size: "4x2", bytes: input.subarray(0, 15), pixels: expected.slice(0, -8) + "ffc5ffff", depth: [] },
            ...(mode === "stream" ? [] : [{ name: "extension", size: "4x2", bytes: input, pixels: expected, depth: [] }])
        ])(`decodes ${coder} packed YUV via ${mode}: $name`, async ({ name, size, bytes, pixels, depth }) => {
            const path = name === "extension" ? `in.${coder}` : "in.ppm";
            const argv = ["-size", size, ...depth, name === "extension" ? path : `${coder}:${mode === "stream" ? "-" : path}`, "-colorspace", "sRGB", "-depth", "8", "rgba:-"];
            let stdout = Buffer.alloc(0), stderr = "", exitCode: number;
            if (mode === "sync") {
                const result = runMagickCliSync(argv, new Map([[path, bytes]]));
                exitCode = result.exitCode;
                stderr = result.stderr;
                stdout = Buffer.from(result.stdoutBytes ?? []);
            } else {
                const fs = new MemoryFileSystem();
                await fs.writeFile(`/${path}`, bytes);
                const args = createCommandArguments(argv);
                const result = await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal,
                    stdin: (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(),
                    stdout: { async write(chunk) { stdout = Buffer.concat([stdout, chunk]); } },
                    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
                });
                exitCode = result.exitCode;
                if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) stdout = Buffer.from(result.stdoutBytes);
            }
            expect(stderr).toBe("");
            expect(exitCode).toBe(0);
            expect(stdout.toString("hex")).toBe(pixels);
        });
    }
}
