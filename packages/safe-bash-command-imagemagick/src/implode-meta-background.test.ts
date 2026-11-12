import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, 7x5 row-major gray bytes.
const nearest = "7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f00000000007f7f00000000007f7f7f00007f7f";
const bilinear = "7f7f7f7f7f7f7f7f7f7f68687f7a7f7f00000000237f7f00000000237f7c4600004677";
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { background: "white", interpolation: "nearest", virtualPixel: "background", channel: "10", implode: true, expected: nearest },
        { background: "red", interpolation: "nearest", virtualPixel: "background", channel: "10", implode: true, expected: nearest },
        { background: "white", interpolation: "bilinear", virtualPixel: "background", channel: "10", implode: true, expected: bilinear },
        { background: "red", interpolation: "bilinear", virtualPixel: "background", channel: "10", implode: true, expected: bilinear },
        { background: "black", interpolation: "nearest", virtualPixel: "background", channel: "10", implode: true, expected: nearest },
        { background: "white", interpolation: "nearest", virtualPixel: "edge", channel: "10", implode: true, expected: "7f".repeat(35) },
        { background: "white", interpolation: "nearest", virtualPixel: "background", channel: "R", implode: true, expected: "00000000000000000000000000000000ffffffffff0000ffffffffff000000ffff0000" },
        { background: "white", interpolation: "nearest", virtualPixel: "background", channel: "10", implode: false, expected: "7f".repeat(35) },
    ])(`${mode}: $background $interpolation $virtualPixel channel $channel implode=$implode`, async ({ background, interpolation, virtualPixel, channel, implode, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = ["-size", "7x5", "xc:black", "xc:black", "xc:black", "xc:white", "xc:gray50", "-combine",
            "-background", background, "-virtual-pixel", virtualPixel, "-interpolate", interpolation,
            ...(implode ? ["-implode", "3"] : []), "-channel", channel, "-separate", "+channel", "-depth", "8", "gray:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            signal: new AbortController().signal,
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
