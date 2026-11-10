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
