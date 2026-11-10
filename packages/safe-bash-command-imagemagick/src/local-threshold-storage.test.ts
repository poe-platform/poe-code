import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI storage class and raw RGBA output.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const type of ["PaletteAlpha", "TrueColorAlpha"]) {
        it.each([
            { operation: ["-format", "%r"], output: "info:/out", expected: "DirectClass sRGB Alpha" },
            { operation: ["-depth", "8"], output: "rgba:/out", expected: "00ffff00ff0000ffffffffff" },
            { operation: ["-cycle", "1", "-depth", "8"], output: "rgba:/out", expected: "ff0000ffffffffff000000ff" }
        ])(`${mode}: ${type} local threshold $operation`, async ({ operation, output, expected }) => {
            const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", files.get("/out")!);
            const argv = ["xc:#20709040", "xc:#804020a0", "xc:#a070a0ee",
                "+append", "-type", type, "-lat", "3x1", ...operation, output];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(output.startsWith("info:") ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("hex")).toBe(expected);
        });
    }
}
