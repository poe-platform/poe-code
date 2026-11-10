import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick PNG64 input with adjacent alpha samples 0x1234 and 0x1235.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAYAAACksqPJAAAAB3RJTUUH6gsHBzkcjsZcnAAAABRJREFUCNdjFDIJq5i1R8iEAQIYASDvArM+9YL1AAAAAElFTkSuQmCC", "base64");

for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([[], ["-alpha", "deactivate"], ["-alpha", "associate"], ["-alpha", "disassociate"], ["-alpha", "off"]])(`${mode}: extracts 16-bit alpha according to its state after %j`, async (...operators) => {
        const argv = ["in.png", ...operators, "-alpha", "extract", "out.png"];
        const files = new Map<string, Uint8Array>([["in.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect([...output.subarray(24, 26)]).toEqual([16, 0]);
        const image = decodeImage(output);
        expect(image.hasAlpha).toBe(false);
        expect([...image.data16!]).toEqual(operators.some(operator => operator === "off" || operator === "disassociate")
            ? Array(8).fill(65535)
            : [0x1234, 0x1234, 0x1234, 65535, 0x1235, 0x1235, 0x1235, 65535]);
    });
}

// Native ImageMagick 7.1.2-35 Q16-HDRI raw RGBA output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { color: "#2060b038", operators: ["-alpha", "off"], hex: "ffffffff" },
        { color: "#2060b038", operators: ["-alpha", "deactivate"], hex: "383838ff" },
        { color: "#2060b038", operators: [], hex: "383838ff" },
        { color: "#2060b0", operators: ["-alpha", "off"], hex: "ffffffff" },
        { color: "#2060b0", operators: [], hex: "ffffffff" },
        { color: "#2060b038", operators: ["-alpha", "off", "-alpha", "activate"], hex: "000000ff" },
        { color: "#2060b038", operators: ["-alpha", "off", "-alpha", "deactivate"], hex: "ffffffff" },
        { color: "#2060b038", operators: ["-alpha", "copy", "-alpha", "deactivate"], hex: "ffffffff" },
    ])(`${mode}: extracts alpha from $color after $operators`, async ({ color, operators, hex }) => {
        const argv = [`xc:${color}`, ...operators, "-alpha", "extract", "-depth", "8", "rgba:out"];
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}

// ImageMagick 7.1.2-35 Q16-HDRI: Disassociate disables extraction,
// while direct channel selection still reads the stored alpha sample.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { operators: ["-alpha", "Disassociate", "-alpha", "extract"], hex: "ff" },
        { operators: ["-alpha", "Disassociate", "-channel", "A", "-separate", "+channel"], hex: "60" },
        { operators: ["-alpha", "Off", "-alpha", "extract"], hex: "ff" },
        { operators: ["-alpha", "On", "-alpha", "extract"], hex: "60" },
    ])(`${mode}: extracts or selects alpha after $operators`, async ({ operators, hex }) => {
        const argv = ["xc:#80402060", ...operators, "-depth", "8", "gray:out"];
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("out")!);
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
