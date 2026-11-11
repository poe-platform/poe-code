import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI: signed hex, decimal leading zeros, and channel isolation.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["Set", "0x2000", "2000"],
        ["Set", "+0x2000", "2000"],
        ["Set", "0X2000", "2000"],
        ["Add", "-0x2000", "1434"],
        ["Add", "-8192", "1434"],
        ["Set", "8192", "2000"],
        ["Set", "4", "0004"],
        ["Set", "64", "0040"],
        ["Set", "0100", "0064"],
        ["Set", "0x20%", "51ec"],
    ])(`${mode}: %s %s preserves native Q16 precision`, async (operator, operand, expected) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const args = ["xc:#345caa80", "-channel", "R", "-evaluate", operator, operand,
            "+channel", "-depth", "16", "-endian", "MSB", "rgba:/out"];
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
        expect(Buffer.from(output).toString("hex")).toBe(`${expected}5c5caaaa8080`);
    });
}
