import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete RGBA output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const depth of [8, 16]) for (const size of [1, 3]) {
        it.each([
            { alpha: "Discrete", background: "none", operation: "-implode", amount: "0.75", expected: "4080c0ff" },
            { alpha: "Deactivate", background: "#20402040", operation: "-implode", amount: "0.75", expected: "4080c0ff" },
            { alpha: "Discrete", background: "white", operation: "-implode", amount: "0.75", expected: "4080c0ff" },
            { alpha: "On", background: "none", operation: "-implode", amount: "0.75", expected: "4080c080" },
            { alpha: "Off", background: "none", operation: "-implode", amount: "0.75", expected: "4080c0ff" },
            { alpha: "Discrete", background: "none", operation: "-swirl", amount: "120", expected: "4080c080" },
        ])(`${mode}, ${size}x${size}, ${depth}-bit: $operation with $alpha alpha and $background background`, async ({ alpha, background, operation, amount, expected }) => {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["-size", `${size}x${size}`, "xc:#4080c080", "-alpha", alpha, "-background", background, operation, amount, "-depth", String(depth), "rgba:/out"];
            let stdout = "", stderr = "";
            const result = mode === "command" ? {
                ...await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }), stdout, stderr,
            } : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            const bytes = Buffer.from(expected.repeat(size * size), "hex");
            expect([...output]).toEqual(depth === 16 ? [...bytes].flatMap(byte => [byte, byte]) : [...bytes]);
        });
    }
}
