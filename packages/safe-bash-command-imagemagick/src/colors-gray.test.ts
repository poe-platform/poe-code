import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI classifies an achromatic reduced palette as Gray.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "gray palette metadata", colors: ["#101010", "#dddddd"], options: ["-colors", "2", "-format", "%r|%[channels]|%k;", "info:/out"], expected: "PseudoClass Gray |gray  2.0|2;", encoding: "utf8" },
        { name: "unreduced gray metadata", colors: ["#101010", "#dddddd"], options: ["-format", "%r|%[channels]|%k;", "info:/out"], expected: "DirectClass sRGB |srgb  3.0|2;", encoding: "utf8" },
        { name: "gray palette pixels", colors: ["#101010", "#dddddd"], options: ["-colors", "2", "-depth", "8", "rgba:/out"], expected: "101010ffddddddff", encoding: "hex" },
        { name: "colored palette metadata", colors: ["#110011", "#ee00ee"], options: ["-colors", "2", "-format", "%r|%[channels]|%k;", "info:/out"], expected: "PseudoClass sRGB |srgb  4.0|2;", encoding: "utf8" }
    ] as const)(`${mode} preserves native $name`, async ({ colors, options, expected, encoding }) => {
        const files = new Map<string, Uint8Array>([["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", files.get("/out")!);
        const args = [...colors.map(color => `xc:${color}`), "+append", ...options];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        expect(Buffer.from(output).toString(encoding)).toBe(expected);
    });
}
