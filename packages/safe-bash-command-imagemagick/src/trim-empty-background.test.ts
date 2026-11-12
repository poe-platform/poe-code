import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "sync"] as const) {
    it.each([
        { background: ["-background", "red"], alpha: ["-alpha", "opaque"], pixel: [255, 0, 0, 255] },
        { background: ["-background", "red"], alpha: [], pixel: [255, 0, 0, 0] },
        { background: ["-set", "background", "red"], alpha: [], pixel: [255, 0, 0, 0] },
        { background: ["-set", "background", "red"], alpha: ["-alpha", "off"], pixel: [255, 0, 0, 255] },
        { background: ["-set", "option:background", "red"], alpha: [], pixel: [255, 0, 0, 0] },
        { background: ["-background", "blue", "-set", "background", "red"], alpha: [], pixel: [0, 0, 255, 0] },
        { background: ["-set", "background", "blue", "-background", "red"], alpha: [], pixel: [255, 0, 0, 0] },
        { background: [], alpha: ["-alpha", "opaque"], pixel: [255, 255, 255, 255] },
    ])(`${mode}: uses the empty trim background ($background, $alpha)`, async ({ background, alpha, pixel }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", keep);
        const argv = ["-size", "6x5", "xc:white", ...background, "-trim", ...alpha, "-depth", "8", "rgba:/out"];
        const args = createCommandArguments(argv);
        const result = mode === "sync" ? runMagickCliSync(argv, files) : await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        });
        expect(result.exitCode).toBe(0);
        expect(mode === "sync" ? files.get("/out") : await fs.readFile("/out")).toEqual(new Uint8Array(pixel));
    });
}

// Native ImageMagick 7.1.2-35 Q16-HDRI values, including non-byte-aligned RGB.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { background: "#123456789abc", depth: "16", alpha: [], hex: "123456789abc0000" },
        { background: "gray(50%)", depth: "16", alpha: [], hex: "8000800080000000" },
        { background: "gray(50%)", depth: "8", alpha: ["-alpha", "opaque"], hex: "808080ff" },
        { background: "#123456", depth: "16", alpha: [], hex: "1212343456560000" },
    ])(`${mode}: retains $background at depth $depth ($alpha)`, async ({ background, depth, alpha, hex }) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const argv = ["-size", "3x2", "xc:#123456", "-colorspace", "sRGB", "-background", background,
            "-trim", ...alpha, "-depth", depth, "-endian", "MSB", "rgba:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("magick: geometry does not contain image '#123456'\n");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
