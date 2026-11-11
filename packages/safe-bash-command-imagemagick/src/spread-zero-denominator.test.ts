import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI; complete RGB8 rasters for three inline colors.
const cases = [
    { radius: "2:0", hex: "00388fb824005c00a3" },
    { radius: "3:0", hex: "5c5200fe0001a4005b" },
    { radius: "2:", hex: "0c00f3cb1a00077d00" },
    { radius: "2:1", hex: "0c00f3cb1a00077d00" }
];

for (const mode of ["command", "buffered", "sync", "retained"] as const) {
    it.each(cases)(`${mode}: matches native spread radius $radius`, async ({ radius, hex }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const args = ["xc:red", "xc:green", "xc:blue", "+append", "-seed", "2", "-virtual-pixel", "tile", "-interpolate", "bilinear", "-spread", radius, "-depth", "8", "rgb:-"];
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
}
