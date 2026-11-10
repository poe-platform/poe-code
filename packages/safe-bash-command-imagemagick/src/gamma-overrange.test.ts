import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { options: ["-evaluate", "Multiply", "3", "-gamma", "1", "-evaluate", "Divide", "3"], hex: "4080c080" },
        { options: ["-evaluate", "Multiply", "3", "-gamma", "2", "-evaluate", "Divide", "3"], hex: "4a688068" },
        { options: ["-gamma", "2"], hex: "80b5ddb5" },
        { options: ["-evaluate", "Multiply", "3", "+gamma", "2", "-evaluate", "Divide", "3"], hex: "30c1ffc1" },
        { options: ["-evaluate", "Multiply", "3", "-evaluate", "Divide", "3"], hex: "4080c080" },
    ])(`preserves native over-range gamma samples via ${mode}: $options`, async ({ options, hex }) => {
        const fs = new MemoryFileSystem();
        const sentinel = new TextEncoder().encode("KEEP");
        await fs.writeFile("/out", sentinel);
        const files = new Map([["/out", sentinel]]);
        const args = ["xc:#4080c080", ...options, "-depth", "8", "rgba:/out"];
        if (mode === "command") {
            const arguments_ = createCommandArguments(args);
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(stderr).toBe("");
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe("");
        }
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
