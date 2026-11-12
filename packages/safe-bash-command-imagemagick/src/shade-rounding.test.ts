import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, including the sample before integer encoding.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { color: "#803040", angle: "0x30", output: ["-depth", "8", "rgb:"], expected: "7f7f7f" },
        { color: "#803040", angle: "0x30", output: ["-endian", "MSB", "-depth", "16", "rgb:"], expected: "7fff7fff7fff" },
        { color: "#803040", angle: "0x30", output: ["-precision", "15", "-format", "%[fx:65535*p.r]", "info:"], expected: "32767.498046875" },
        { color: "#203040", angle: "0x30", output: ["-depth", "8", "rgb:"], expected: "808080" },
        { color: "#803040", angle: "0x45", output: ["-depth", "8", "rgb:"], expected: "b4b4b4" },
    ])(`${mode}: shades $color at $angle to $expected`, async ({ color, angle, output, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = [`xc:${color}`, "-shade", angle, ...output.slice(0, -1), `${output.at(-1)}${mode === "command" ? "-" : "/out"}`];
        const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
        const bytes = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString(output.at(-1) === "info:" ? "utf8" : "hex")).toBe(expected);
    });
}
