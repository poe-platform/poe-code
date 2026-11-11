import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 results.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { color: "#9050c080", options: ["+dither", "-posterize", "3", "-cycle", "0"], expected: "8080ff80" },
        { color: "#9050c080", options: ["+dither", "-posterize", "3", "-cycle", "1"], expected: "8080ff80" },
        { color: "#9050c080", options: ["+dither", "-posterize", "3"], expected: "8080ff80" },
        { color: "#9050c080", options: ["-colors", "1", "-cycle", "1"], expected: "9050c080" },
        { color: "#9050c0", options: ["+dither", "-posterize", "3", "-cycle", "1"], expected: "8080ffff" }
    ])(`${mode}: $color $options`, async ({ color, options, expected }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-seed", "42", `xc:${color}`, ...options, "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
