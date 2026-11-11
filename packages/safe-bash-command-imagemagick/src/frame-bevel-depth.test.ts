import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, including unbeveled and 8-bit controls.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { geometry: "3x3+1+1", depth: "16", corner: "6bdfa880c9927070", hash: "fdf4c9ce618839d9ae5d3f3147849a202787c7aa4f90a9d90257e8043d1b72c8" },
        { geometry: "3x3+0+0", depth: "16", corner: "28288080b0b07070", hash: "62097a36f2c9ef5d6370a11e1a53d3e452ea0eb5d059b084bde505cfb87ee0f4" },
        { geometry: "3x3+1+1", depth: "8", corner: "6ba8c970", hash: "48c6bdb63a0bcd2bec01d97258511904e03380ae806a98c7a0816a22990657f3" }
    ])(`${mode} preserves frame shades at depth $depth ($geometry)`, async ({ geometry, depth, corner, hash }) => {
        const fs = new MemoryFileSystem();
        const args = ["-size", "3x2", "xc:#c0306090", "-mattecolor", "#2880b070", "-alpha", "opaque",
            "-compose", "Over", "-frame", geometry, "-depth", depth, "-endian", "MSB", "rgba:-"];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(chunks)
            : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
        const pixelBytes = depth === "16" ? 8 : 4;
        expect(bytes.length).toBe(9 * 8 * pixelBytes);
        expect(bytes.subarray(0, pixelBytes).toString("hex")).toBe(corner);
        expect(bytes.subarray(30 * pixelBytes, 31 * pixelBytes).toString("hex")).toBe(depth === "16" ? "c0c030306060ffff" : "c03060ff");
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    });
}
