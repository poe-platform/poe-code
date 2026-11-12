import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI references, including unchanged controls.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const [type, hash, colors, hex] of [
        ["Palette", "75e97e88241d4eb5dd4b4fa915f8210222eb01fdcad0551cb4930c2389cb879c", 182, "e08020ff"],
        ["PaletteAlpha", "917f90ed155da4b491000fdc3a32d65ff4f8225032b09cc5c92a75058c58a69a", 182, "e0802040"],
        ["", "2ccee45765af113e5bc0e0853166cc3f190c87c23fc4b67ad3eafa45c644280d", 512, "e0802040"]
    ] as const) {
        it.each([false, true])(`${mode}: montage ${type || "control"}, transparent=%s`, async transparent => {
            const pixels = Uint8Array.from({ length: 32 * 16 * 3 }, (_, index) => {
                const x = Math.floor(index / 3) % 32, y = Math.floor(index / 96);
                return [(x * 17) % 256, (x * 11 + y * 43) % 256, (255 - x * 13) % 256][index % 3]!;
            });
            const input = Buffer.concat([Buffer.from("P6\n32 16\n255\n"), pixels]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const files = new Map([["/in.ppm", input as Uint8Array]]);
            const args = ["montage", ...(transparent ? ["-background", "none", "xc:#e0802040"] : ["/in.ppm"]),
                ...(type ? ["-type", type] : []), "-tile", "1x1", "-geometry", "+0+0", "-depth", "8", transparent ? "rgba:-" : "rgb:-"];
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const output = mode === "command" ? Buffer.concat(chunks) : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
            if (transparent) expect(output.toString("hex")).toBe(hex);
            else {
                expect(output.length).toBe(1536);
                expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
                expect(new Set(Array.from({ length: 512 }, (_, index) => output.subarray(index * 3, index * 3 + 3).toString("hex"))).size).toBe(colors);
            }
        });
    }
}
