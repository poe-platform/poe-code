import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Exact pixels and page geometry from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "negate selected pixel", after: ["-negate", "+region"], hex: "00ffffff0000ffff" },
        { name: "export active region", hex: "ff0000000000ffff" },
        { name: "translucent export", translucent: true, hex: "ff0000800000c080" },
        { name: "empty trim", empty: true, hex: "ffffff00" },
        { name: "edit empty trim", empty: true, after: ["-negate", "+region"], hex: "000000ff" },
        { name: "vertical trim with page offset", vertical: true, region: "1x1+0+1", after: ["-negate", "+region"], hex: "00ffffff0000ffff" },
        { name: "remove region", after: ["+region"], hex: "ff0000ff0000ffff" },
        { name: "no region", region: "", hex: "ff0000ff0000ffff" },
        { name: "full region", region: "4x1+0+0", after: ["+region"], hex: "ff0000ff0000ffff" },
    ])(`${mode}: $name`, async ({ after = [], translucent, empty, vertical, region = "1x1+1+0", hex }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const input = empty ? ["-size", "4x1", "xc:white"]
            : translucent ? ["xc:none", "xc:#ff000080", "xc:#0000ff80", "xc:none", "+append"]
            : ["xc:white", "xc:red", "xc:blue", "xc:white", ...(vertical ? ["-append", "-repage", "8x9+2+3"] : ["+append"])];
        const argv = [...input, ...(region ? ["-region", region] : []), "-trim", ...after,
            "-depth", "8", "-write", "rgba:/pixels", "-format", "%wx%h|%g", "info:/geometry"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe(empty ? "magick: geometry does not contain image 'white'\n" : "");
        const pixels = mode === "command" || mode === "retained" ? await fs.readFile("/pixels") : files.get("/pixels")!;
        const geometry = mode === "command" || mode === "retained" ? await fs.readFile("/geometry") : files.get("/geometry")!;
        expect.soft(Buffer.from(pixels).toString("hex")).toBe(hex);
        expect(new TextDecoder().decode(geometry)).toBe(empty ? "1x1|4x1-1-1" : vertical ? "1x2|1x4+2+4" : "2x1|4x1+1+0");
    });
}
