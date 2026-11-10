import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: Set percentages use QuantumRange + 1.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["Set", "75%", "c000"],
        ["Set", "49152", "c000"],
        ["Set", "49151.25", "bfff"],
        ["Add", "75%", "c000"],
        ["Set", "0%", "0000"],
        ["Set", "100%", "ffff"],
    ])(`${mode}: %s %s preserves native Q16 precision`, async (operator, operand, expected) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const args = ["xc:black", "-channel", "G", "-evaluate", operator, operand,
            "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
