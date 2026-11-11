import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

const first = "093e73ffa8dd12ff477cb1ffe61b50ff";
const second = "85baefff24598effc3f82dff6297ccff";
const rgb = "093e73a8dd12477cb1e61b5085baef24598ec3f82d6297cc";

for (const mode of ["file", "stream", "sync"] as const) {
    it.each([
        { coder: "rgb", selector: "", input: rgb, expected: first + second },
        { coder: "rgb", selector: "[1]", input: rgb, expected: second },
        { coder: "rgb", selector: "[0-1]", input: rgb, expected: first + second },
        { coder: "rgb", selector: "", input: rgb.slice(0, 24), expected: first },
        { coder: "gray", selector: "[1]", input: "093e73a8dd12477c", expected: "ddddddff121212ff474747ff7c7c7cff" },
        { coder: "rgb", selector: "[2]", input: rgb, expected: "4b454550", error: "invalid image index 2" }
    ])(`reads raw scenes via ${mode}: $coder $selector $input`, async ({ coder, selector, input, expected, error }) => {
        const bytes = Buffer.from(input, "hex");
        const argv = ["-size", "2x2", "-depth", "8", `${coder}:${mode === "stream" ? "-" : "raw.bin"}${selector}`, "-append", "-depth", "8", "rgba:out"];
        let stderr = "", output: Uint8Array, exitCode: number;
        if (mode === "sync") {
            const files = new Map<string, Uint8Array>([["raw.bin", bytes], ["out", Buffer.from("KEEP")]]);
            const result = runMagickCliSync(argv, files);
            stderr = result.stderr;
            exitCode = result.exitCode;
            output = files.get("out")!;
        } else {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/raw.bin", bytes);
            await fs.writeFile("/out", Buffer.from("KEEP"));
            const args = createCommandArguments(argv);
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal,
                stdin: (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            exitCode = result.exitCode;
            output = await fs.readFile("/out");
        }
        expect(exitCode).toBe(error ? 1 : 0);
        if (error) expect(stderr).toContain(error);
        else expect(stderr).toBe("");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}

for (const mode of ["file", "stream", "sync"] as const) {
    for (const destination of ["rgb:-", "rgb:out-%d.bin"]) {
        it.each([
            { selector: "0", scenes: [0] },
            { selector: "0,0", scenes: [0] },
            { selector: "1,1", scenes: [1] },
            { selector: "2,2", scenes: [2] },
            { selector: "0,2,2", scenes: [0, 2, 2] }
        ])(`reads repeated RGB scenes via ${mode} to ${destination === "rgb:-" ? "stdout" : "numbered files"}: $selector`, async ({ selector, scenes }) => {
            const frames = ["010203040506", "111213141516", "212223242526", "313233343536"];
            const bytes = Buffer.from(frames.join(""), "hex");
            const argv = ["-size", "2x1", "-depth", "8", `rgb:${mode === "stream" ? "-" : "in.bin"}[${selector}]`, "-scene", "0", destination];
            const files = new Map<string, Uint8Array>([["in.bin", bytes]]);
            let stdout = Buffer.alloc(0);
            if (mode === "sync") {
                const result = runMagickCliSync(argv, files);
                expect(result.exitCode).toBe(0);
                expect(result.stderr).toBe("");
                stdout = Buffer.from(result.stdoutBytes ?? []);
            } else {
                const fs = new MemoryFileSystem();
                await fs.writeFile("/in.bin", bytes);
                const args = createCommandArguments(argv);
                let stderr = "";
                const result = await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal,
                    stdin: (async function* () { yield bytes; })(),
                    stdout: { async write(chunk) { stdout = Buffer.concat([stdout, chunk]); } },
                    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
                });
                expect(result.exitCode).toBe(0);
                expect(stderr).toBe("");
                if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) stdout = Buffer.from(result.stdoutBytes);
                for (const entry of await fs.readdir("/")) {
                    if (entry.name.startsWith("out-")) files.set(entry.name, await fs.readFile(`/${entry.name}`));
                }
            }
            if (destination === "rgb:-") expect(stdout.toString("hex")).toBe(scenes.map(scene => frames[scene]).join(""));
            else {
                for (const [i, scene] of scenes.entries()) expect(Buffer.from(files.get(`out-${i}.bin`)!).toString("hex")).toBe(frames[scene]);
                expect([...files.keys()].filter(name => name.startsWith("out-"))).toHaveLength(scenes.length);
            }
        });
    }
}
