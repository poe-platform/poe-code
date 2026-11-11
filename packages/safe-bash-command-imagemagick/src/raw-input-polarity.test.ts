import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI references for packed 0xa5 samples.
for (const mode of ["command", "buffered", "sync", "retained"] as const) {
    for (const polarity of [undefined, "min-is-black", "min-is-white", "MIN-IS-WHITE"]) {
        it.each([
            { coder: "gray", depth: 1, input: "a5", black: "ffffffff000000ffffffffff000000ff000000ffffffffff000000ffffffffff", white: "000000ffffffffff000000ffffffffffffffffff000000ffffffffff000000ff" },
            { coder: "r", depth: 1, input: "a5", black: "ff0000ff000000ffff0000ff000000ff000000ffff0000ff000000ffff0000ff", white: "000000ffff0000ff000000ffff0000ffff0000ff000000ffff0000ff000000ff" },
            { coder: "rgb", depth: 1, input: "a5a5a5", black: "ff00ffff0000ffff00ffffff00ff00ff00ff00ffffff00ffff0000ffff00ffff" },
            { coder: "gray", depth: 2, input: "a5a5", black: "aaaaaaffaaaaaaff555555ff555555ffaaaaaaffaaaaaaff555555ff555555ff" },
            { coder: "r", depth: 2, input: "a5a5", black: "aa0000ffaa0000ff550000ff550000ffaa0000ffaa0000ff550000ff550000ff" },
        ])(`${mode} ${polarity}: reads $depth-bit $coder samples`, async ({ coder, depth, input, black, white }) => {
            const bytes = Buffer.from(input, "hex");
            const files = new Map<string, Uint8Array>([["/in.ppm", bytes]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", bytes);
            const args = ["-size", "8x1", "-depth", String(depth),
                ...(polarity ? ["-define", `quantum:polarity=${polarity}`] : []),
                `${coder}:/in.ppm`, "-depth", "8", "rgba:-"];
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes) : Buffer.concat(chunks);
            expect(output.toString("hex")).toBe(polarity?.toLowerCase() === "min-is-white" ? white ?? black : black);
        });
    }
}
