import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const colors = ["#10203080", "#50708090", "#91a3b4a0", "#c2d3e4b0"];
// ImageMagick 7.1.2-35 Q16-HDRI: the fourth plane replaces the first image's alpha.
const expected = ["1e203080", "1e6a3080", "1e6aa080", "1e6aa0d1"];
for (const mode of ["command", "buffered", "sync", "retained"] as const) {
    it.each([1, 2, 3, 4])(`${mode}: preserves or replaces alpha with %i planes`, async count => {
        const files = new Map<string, Uint8Array>([["/out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", Buffer.from("KEEP"));
        const args = [...colors.slice(0, count).map(color => `xc:${color}`), "-combine", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected[count - 1]);
    });
}
