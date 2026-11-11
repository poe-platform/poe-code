import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, full RGB bytes and dimensions/color counts.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { input: ["xc:red", "xc:blue", "+append"], segmented: true, pixels: "ff0000ff0000", info: "2x1 1" },
        { input: ["xc:red", "xc:blue", "+append"], segmented: false, pixels: "ff00000000ff", info: "2x1 2" },
        { input: ["-size", "12x1", "gradient:red-blue"], segmented: true, pixels: "ff0000".repeat(12), info: "12x1 1" },
        { input: ["-size", "12x1", "gradient:red-blue"], segmented: false, pixels: "ff0000e80017d1002eb90046a2005d8b007474008b5d00a24600b92e00d11700e80000ff", info: "12x1 12" },
        { input: ["xc:rgba(255,0,0,0.5)", "xc:blue", "+append"], segmented: true, pixels: "ff0000ffff0000ff", info: "2x1 1", coder: "rgba" },
        { input: ["xc:red", "xc:blue", "+append", "-colors", "2"], segmented: true, pixels: "ff0000ff0000", info: "2x1 1" },
        { input: ["xc:blue", "xc:red", "+append"], segmented: true, pixels: "ff0000ff0000", info: "2x1 1" },
        { input: ["xc:red", "xc:lime", "xc:blue", "+append"], segmented: true, pixels: "555555".repeat(3), info: "3x1 1" },
        { input: ["-size", "8x8", "xc:red", "xc:blue", "+append"], segmented: true, pixels: "800080".repeat(128), info: "16x8 1" },
        { input: ["xc:#4080c0"], segmented: true, pixels: "000000", info: "1x1 1" },
        { input: ["-size", "32x32", "xc:red", "xc:lime", "xc:blue", "+append"], segmented: true, pixels: ("ff0000".repeat(32) + "00ff00".repeat(32) + "0000ff".repeat(32)).repeat(32), info: "96x32 3" },
    ])(`${mode}: $input segmented=$segmented`, async ({ input, segmented, pixels, info, coder }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = [...input, ...(segmented ? ["-segment", "1x1"] : []), "-depth", "8", "-write", `${coder ?? "rgb"}:/pixels`, "-format", "%wx%h %k", "info:/info"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/pixels") : files.get("/pixels")!;
        const metadata = mode === "command" || mode === "retained" ? await fs.readFile("/info") : files.get("/info")!;
        expect(Buffer.from(output).toString("hex")).toBe(pixels);
        expect(new TextDecoder().decode(metadata)).toBe(info);
    });
}
