import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n12 8\n255\n"), Buffer.from(Array.from({ length: 288 }, (_, i) => (i * 13 + 7) % 256))]);
const unmasked = "528bf55864c1e4ae2f9b9c95256fde30722ebc3d350e1ca895e67f7433129749";

// Native ImageMagick 7.1.2-35 Q16-HDRI dimensions, page, and complete RGBA8 output.
// Use native -limit memory 0 for the small mask: its memory cache leaves
// uninitialized samples whose geometry and pixels vary with thread count.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "one-pixel mask", options: ["-write-mask", "xc:white"], geometry: "1x1 40x36-1-1", size: 4, hash: "df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119", warning: true },
        { name: "full-size mask", options: ["-size", "12x8", "-write-mask", "xc:white"], geometry: "1x1 40x36-1-1", size: 4, hash: "df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119", warning: true },
        { name: "existing alpha", options: ["-alpha", "set", "-size", "12x8", "-write-mask", "xc:white"], geometry: "32x28 40x36+0-1", size: 3584, hash: "dd9e5e22fda4119614a7b344a275facc942299d6ab5d90374af915ce0d1cfc51", warning: false },
        { name: "transparent border", options: ["-bordercolor", "none", "-size", "12x8", "-write-mask", "xc:white"], geometry: "13x8 40x36+10+9", size: 416, hash: "ddc5c37306abaa1580fe20bc61a3241c74c4ba5f157752e9c10e39579e10a8a9", warning: false },
        { name: "cleared mask", options: ["-write-mask", "xc:white", "+write-mask"], geometry: "40x36 40x36+0-1", size: 5760, hash: unmasked, warning: false },
        { name: "no mask", options: [], geometry: "40x36 40x36+0-1", size: 5760, hash: unmasked, warning: false },
    ])(`${mode}: renders polaroid with $name`, async ({ options, geometry, size, hash, warning }) => {
        for (const raw of [false, true]) {
            const argv = ["/in.ppm", ...options, "-polaroid", "0", ...(raw ? ["-depth", "8", "rgba:/out"] : ["-format", "%wx%h %g", "info:/out"])];
            const files = new Map<string, Uint8Array>([["/in.ppm", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : mode === "buffered" || mode === "retained" ? await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files)
                : await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                });
            const diagnostics = "stderr" in result ? String(result.stderr) : stderr;
            expect(result.exitCode, diagnostics).toBe(0);
            expect(diagnostics.includes("geometry does not contain image")).toBe(warning);
            if (!warning) expect(diagnostics).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(raw ? createHash("sha256").update(output).digest("hex") : new TextDecoder().decode(output)).toBe(raw ? hash : geometry);
            if (raw) expect(output.byteLength).toBe(size);
        }
    });
}
