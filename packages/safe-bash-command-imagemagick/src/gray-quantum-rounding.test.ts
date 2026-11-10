import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI references, including alpha and sRGB controls.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { color: "#20785020", space: "Gray", depth: "16", hex: "62c962c962c92020" },
        { color: "#20785020", space: "Gray", depth: "8", hex: "62626220" },
        { color: "#4080c080", space: "Gray", depth: "16", hex: "777a777a777a8080" },
        { color: "#20785020", space: "sRGB", depth: "16", hex: "2020787850502020" },
    ])(`matches native grayscale rounding via ${mode}: $color $space $depth`, async ({ color, space, depth, hex }) => {
        const fs = new MemoryFileSystem();
        const sentinel = new TextEncoder().encode("KEEP");
        await fs.writeFile("/out", sentinel);
        const files = new Map([["/out", sentinel]]);
        const args = [`xc:${color}`, "-colorspace", space, "-depth", depth, "-endian", "MSB", "rgba:/out"];
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
