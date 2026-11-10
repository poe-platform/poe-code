import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI retains an index channel for Bilevel, including a single color.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "single-black Bilevel palette", input: ["xc:black"], operations: ["-type", "Bilevel", "-cycle", "1", "-depth", "8", "rgba:/out"], expected: "000000ff", encoding: "hex" },
        { name: "single-white Bilevel palette", input: ["xc:white"], operations: ["-type", "Bilevel", "-cycle", "1", "-depth", "8", "rgba:/out"], expected: "ffffffff", encoding: "hex" },
        { name: "two-color Bilevel palette", input: ["xc:white", "xc:black", "+append"], operations: ["-type", "Bilevel", "-cycle", "1", "-depth", "8", "rgba:/out"], expected: "000000ffffffffff", encoding: "hex" },
        { name: "two-color Bilevel metadata", input: ["xc:white", "xc:black", "+append"], operations: ["-type", "Bilevel", "-format", "%r|%[channels]", "info:/out"], expected: "PseudoClass Gray |gray  2.0", encoding: "utf8" },
        { name: "single-color Bilevel metadata", input: ["xc:black"], operations: ["-type", "Bilevel", "-format", "%r|%[channels]", "info:/out"], expected: "PseudoClass Gray |gray  2.0", encoding: "utf8" },
        { name: "Bilevel pixels", input: ["xc:white", "xc:black", "+append"], operations: ["-type", "Bilevel", "-depth", "8", "rgba:/out"], expected: "ffffffff000000ff", encoding: "hex" },
        { name: "two-color Grayscale metadata", input: ["xc:white", "xc:black", "+append"], operations: ["-type", "Grayscale", "-format", "%r|%[channels]", "info:/out"], expected: "DirectClass Gray |gray  1.0", encoding: "utf8" },
        { name: "single-color Grayscale metadata", input: ["xc:black"], operations: ["-type", "Grayscale", "-format", "%r|%[channels]", "info:/out"], expected: "DirectClass Gray |gray  1.0", encoding: "utf8" }
    ] as const)(`${mode} preserves native $name`, async ({ input, operations, expected, encoding }) => {
        const files = new Map<string, Uint8Array>([["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", files.get("/out")!);
        const args = [...input, ...operations];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString(encoding)).toBe(expected);
    });
}
