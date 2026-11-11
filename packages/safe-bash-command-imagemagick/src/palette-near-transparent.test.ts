import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: dither assignment caches associated RGBA
// in six-bit cubes, so nearby alpha colors can reuse the first assigned color.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of [["-type", "PaletteAlpha"], ["-colors", "256"]]) {
        it.each([
            { name: "alpha 1", colors: ["ff000000", "80008001"], expected: "0000000000000000" },
            { name: "alpha 2", colors: ["ff000000", "80008002"], expected: "0000000000000000" },
            { name: "last colliding alpha", colors: ["ff000000", "ffffff03"], expected: "0000000000000000" },
            { name: "next alpha cube", colors: ["ff000000", "80008004"], expected: "0000000080008004" },
            { name: "visible alpha", colors: ["ff000000", "80008010"], expected: "0000000080008010" },
            { name: "fully transparent", colors: ["ff000000", "80008000"], expected: "0000000000000000" },
            { name: "reversed swatches", colors: ["80008001", "ff000000"], expected: "8000800180008001" },
            { name: "single translucent color", colors: ["80008001"], expected: "80008001" },
            { name: "unique colors after assignment", colors: ["ff000000", "80008001"], after: ["-unique-colors"], expected: "00000000" },
            { name: "disabled dithering", colors: ["ff000000", "80008001"], before: ["+dither"], expected: "0000000080008001" },
            { name: "Floyd-Steinberg", colors: ["ff000000", "80008002"], before: ["-dither", "FloydSteinberg"], expected: "0000000000000000" },
            { name: "unquantized control", colors: ["ff000000", "80008001"], skip: true, expected: "ff00000080008001" },
        ])(`${mode}, ${operation.join(" ")}: $name`, async ({ colors, before = [], after = [], skip, expected }) => {
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const argv = [...colors.map(color => `xc:#${color}`), "+append", ...before, ...(skip ? [] : operation), ...after, "-depth", "8", "rgba:/out"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
