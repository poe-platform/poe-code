import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each([
        ["A", true, "9b6e3a60b2ffffa0cface0ea"],
        ["RGB", true, "7d532060268d8da09474a4ea"],
        ["A", false, "8056236040a0a0a09070a0ea"],
        ["RGB", false, "8056236040a0a0a09070a0ea"],
    ] as const)(`preserves extended %s samples through CLAHE=%s via ${mode}`, async (channel, filter, expected) => {
        const files = new Map([["out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", Buffer.from("KEEP"));
        const args = ["xc:#80562360", "xc:#40a0a0a0", "xc:#9070a0ea", "+append",
            "-channel", channel, "-evaluate", "multiply", "2", "+channel",
            ...(filter ? ["-clahe", "2x2+16+2"] : []),
            "-channel", channel, "-evaluate", "divide", "2", "+channel", "-depth", "8", "rgba:out"];
        let exitCode: number, stderr = "";
        if (mode === "public") {
            const argumentValues = createCommandArguments(args);
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += Buffer.from(chunk); } },
            });
            exitCode = result.exitCode;
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            exitCode = result.exitCode;
            stderr = result.stderr;
        }
        expect(exitCode, stderr).toBe(0);
        const output = mode === "public" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
