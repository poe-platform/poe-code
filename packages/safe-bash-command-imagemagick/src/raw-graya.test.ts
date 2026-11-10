import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

for (const mode of ["command", "stream", "sync"] as const) {
    it.each([
        // Native ImageMagick 7.1.2-35 Q16-HDRI output, including the GRAY control.
        { coder: "graya", options: ["-size", "2x2", "-depth", "8"], input: "093e73a8dd12477c", expected: "0909093e737373a8dddddd124747477c", error: "" },
        { coder: "graya", options: ["-size", "2x2", "-depth", "16"], input: "093e73a8dd12477cb1e61b5085baef24", expected: "3e3e3ea81313137ce6e6e650bababa25", error: "" },
        { coder: "gray", options: ["-size", "2x2", "-depth", "8"], input: "093e73a8", expected: "090909ff3e3e3eff737373ffa8a8a8ff", error: "" },
        { coder: "graya", options: ["-size", "2x2", "-depth", "8", "-interlace", "Plane"], input: "1f364d647b92a9c0", expected: "1f1f1f7b363636924d4d4da9646464c0", error: "" },
        { coder: "graya", options: ["-size", "2x2", "-depth", "8", "-interlace", "None"], input: "1f364d647b92a9c0", expected: "1f1f1f364d4d4d647b7b7b92a9a9a9c0", error: "" },
        { coder: "graya", options: ["-size", "2x2", "-depth", "8", "-interlace", "Plane", "+interlace"], input: "1f364d647b92a9c0", expected: "1f1f1f364d4d4d647b7b7b92a9a9a9c0", error: "" },
        { coder: "gray", options: ["-size", "2x2", "-depth", "8", "-interlace", "Plane"], input: "1f364d64", expected: "1f1f1fff363636ff4d4d4dff646464ff", error: "" },
        { coder: "graya", options: ["-size", "2x2", "-depth", "16", "-endian", "MSB", "-interlace", "Plane"], input: "1f0036004d0064007b009200a900c000", expected: "1f1f1f7b363636914d4d4da8646464bf", error: "" },
        { coder: "graya", options: ["-size", "2x2", "-depth", "16", "-endian", "LSB", "-interlace", "Plane"], input: "001f0036004d0064007b009200a900c0", expected: "1f1f1f7b363636914d4d4da8646464bf", error: "" },
        { coder: "graya", options: [], input: "093e73a8dd12477c", expected: "4b454550", error: "must specify image size" },
        { coder: "graya", options: ["-size", "2x2", "-depth", "8"], input: "093e73a8dd1247", expected: "4b454550", error: "unexpected end-of-file" }
    ])(`reads raw grayscale (${mode}): $coder $options $input`, async ({ coder, options, input, expected, error }) => {
        const bytes = Buffer.from(input, "hex");
        const argv = [...options, `${coder}:${mode === "stream" ? "-" : "raw.bin"}`, "-append", "-interlace", "None", "-depth", "8", "rgba:out"];
        let output: Uint8Array, stderr = "", exitCode: number;
        if (mode === "sync") {
            const files = new Map<string, Uint8Array>([["raw.bin", bytes], ["out", Buffer.from("KEEP")]]);
            const result = runMagickCliSync(argv, files);
            ({ stderr, exitCode } = result);
            output = files.get("out")!;
        } else {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/raw.bin", bytes);
            await fs.writeFile("/out", Buffer.from("KEEP"));
            const args = createCommandArguments(argv);
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal,
                stdin: (async function* () { if (mode === "stream") for (const byte of bytes) yield Uint8Array.of(byte); })(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            exitCode = result.exitCode;
            output = await fs.readFile("/out");
        }
        if (error) expect(stderr).toContain(error);
        else expect(stderr).toBe("");
        expect(exitCode).toBe(error ? 1 : 0);
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
