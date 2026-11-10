import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    // Native ImageMagick 7: empty axes retain raster size but use page dimensions for gravity.
    it.each([
        ["x2", "8x6+2-1", "Center", 3, "ffffffffffffffffffffffffffffffffffff"],
        ["2x", "8x6+2-1", "Center", 2, "ffffffffffffffffffffffff"],
        ["0x2", "8x6+2-1", "Center", 3, "ffffffffffffffffffffffffffffffffffff"],
        ["2x0", "8x6+2-1", "Center", 2, "ffffffffffffffffffffffff"],
        ["x2", "8x6+2-1", "NorthWest", 3, "0102030405060708090a0b0c0d0e0f101112"],
        ["3x2", "8x6+2-1", "Center", 3, "0102030405060708090a0b0c0d0e0f101112"],
        ["x2", "", "Center", 3, "0102030405060708090a0b0c0d0e0f101112"],
        ["x2", "4x3+2-1", "Center", 3, "ffffffffffff010203ffffffffffff0a0b0c"],
        ["x2+1+0", "4x3+2-1", "Center", 3, "ffffff010203040506ffffff0a0b0c0d0e0f"],
        ["0x100%", "8x6+2-1", "Center", 3, "ffffffffffffffffffffffffffffffffffff"],
        ["100x0%", "8x6+2-1", "Center", 3, "ffffffffffffffffffffffffffffffffffff"],
        ["x100%", "8x6+2-1", "Center", 3, "0102030405060708090a0b0c0d0e0f101112"],
    ] as const)(`places extent %s on page %s with %s gravity (${mode})`, async (geometry, page, gravity, width, hex) => {
        const input = Uint8Array.from({ length: 18 }, (_, i) => i + 1);
        const files = new Map([["/in.rgb", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.rgb", input);
        const args = ["-size", "3x2", "-depth", "8", "rgb:/in.rgb",
            ...(page ? ["-repage", page] : []), "-gravity", gravity, "-extent", geometry,
            "-write", "rgb:/out.rgb", "-format", "%wx%h|%g;", "info:"];
        let stdout = "", stderr = "";
        if (mode === "command") {
            const argumentValues = createCommandArguments(args);
            const result = await createMagickCommand().execute({ command: "magick", args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            stdout = result.stdout;
            stderr = result.stderr;
        }
        expect(stderr).toBe("");
        expect(stdout).toBe(`${width}x2|${page ? (width === 2 ? "5x6+1-1" : page) : `${width}x2+0+0`};`);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.rgb") : files.get("/out.rgb")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
