import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI: alpha samples and rendered RGBA8.
const cases = [
    {"space": "RGB", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "RGB", "-background", "none", "-vignette", "0x1+1+1", "-channel", "A", "-separate", "-depth", "8", "gray:/out"], "hex": "577f927fb8d292d2f0"},
    {"space": "RGB", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "RGB", "-background", "none", "-vignette", "0x1+1+1", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], "hex": "345caa57345caa7f345caa92345caa7f345caab8345caad2345caa92345caad2345caaf0"},
    {"space": "RGB", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "RGB", "-background", "white", "-vignette", "0x1+1+1", "-channel", "A", "-separate", "-depth", "8", "gray:/out"], "hex": "ffffffffffffffffff"},
    {"space": "RGB", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "RGB", "-background", "white", "-vignette", "0x1+1+1", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], "hex": "d6d9e7ffbfc4daffb2bad4ffbfc4daff96a1c7ff7d8cbdffb2bad4ff7d8cbdff556fb0ff"},
    {"space": "LinearGray", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "LinearGray", "-background", "none", "-vignette", "0x1+1+1", "-channel", "A", "-separate", "-depth", "8", "gray:/out"], "hex": "577f927fb8d292d2f0"},
    {"space": "LinearGray", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "LinearGray", "-background", "none", "-vignette", "0x1+1+1", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], "hex": "5e5e5e575e5e5e7f5e5e5e925e5e5e7f5e5e5eb85e5e5ed25e5e5e925e5e5ed25e5e5ef0"},
    {"space": "LinearGray", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "LinearGray", "-background", "white", "-vignette", "0x1+1+1", "-channel", "A", "-separate", "-depth", "8", "gray:/out"], "hex": "ffffffffffffffffff"},
    {"space": "LinearGray", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "LinearGray", "-background", "white", "-vignette", "0x1+1+1", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], "hex": "dadadaffc5c5c5ffbababaffc5c5c5ffa2a2a2ff8d8d8dffbababaff8d8d8dff717171ff"},
    {"space": "sRGB", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "sRGB", "-background", "none", "-vignette", "0x1+1+1", "-channel", "A", "-separate", "-depth", "8", "gray:/out"], "hex": "183649367aa549a5de"},
    {"space": "sRGB", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "sRGB", "-background", "none", "-vignette", "0x1+1+1", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], "hex": "345caa18345caa36345caa49345caa36345caa7a345caaa5345caa49345caaa5345caade"},
    {"space": "sRGB", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "sRGB", "-background", "white", "-vignette", "0x1+1+1", "-channel", "A", "-separate", "-depth", "8", "gray:/out"], "hex": "ffffffffffffffffff"},
    {"space": "sRGB", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "sRGB", "-background", "white", "-vignette", "0x1+1+1", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], "hex": "ecf0f7ffd4dcedffc5d0e7ffd4dcedff9eb1d6ff7c96c8ffc5d0e7ff7c96c8ff4e71b5ff"},
    {"space": "Gray", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "Gray", "-background", "none", "-vignette", "0x1+1+1", "-channel", "A", "-separate", "-depth", "8", "gray:/out"], "hex": "183649367aa549a5de"},
    {"space": "Gray", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "Gray", "-background", "none", "-vignette", "0x1+1+1", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], "hex": "595959185959593659595949595959365959597a595959a559595949595959a5595959de"},
    {"space": "Gray", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "Gray", "-background", "white", "-vignette", "0x1+1+1", "-channel", "A", "-separate", "-depth", "8", "gray:/out"], "hex": "ffffffffffffffffff"},
    {"space": "Gray", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "Gray", "-background", "white", "-vignette", "0x1+1+1", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], "hex": "efefefffdcdcdcffcfcfcfffdcdcdcffb0b0b0ff949494ffcfcfcfff949494ff6e6e6eff"},
    {"space": "scRGB", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "scRGB", "-background", "none", "-vignette", "0x1+1+1", "-channel", "A", "-separate", "-depth", "8", "gray:/out"], "hex": "183649367aa549a5de"},
    {"space": "scRGB", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "scRGB", "-background", "none", "-vignette", "0x1+1+1", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], "hex": "345caa18345caa36345caa49345caa36345caa7a345caaa5345caa49345caaa5345caade"},
    {"space": "scRGB", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "scRGB", "-background", "white", "-vignette", "0x1+1+1", "-channel", "A", "-separate", "-depth", "8", "gray:/out"], "hex": "ffffffffffffffffff"},
    {"space": "scRGB", "args": ["-size", "3x3", "xc:#345caa", "-colorspace", "scRGB", "-background", "white", "-vignette", "0x1+1+1", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], "hex": "f4f5f9ffe6e8f0ffdde0ebffe6e8f0ffc2c7dcffa5aecdffdde0ebffa5aecdff6e81b8ff"},
    {"space": "RGB", "args": ["-size", "1x1", "xc:#345caa", "-colorspace", "RGB", "-background", "none", "-vignette", "0x1+0+0", "-channel", "A", "-separate", "-depth", "8", "gray:/out"], "hex": "ff"},
    {"space": "LinearGray", "args": ["-size", "1x1", "xc:#345caa", "-colorspace", "LinearGray", "-background", "none", "-vignette", "0x1+0+0", "-channel", "A", "-separate", "-depth", "8", "gray:/out"], "hex": "ff"},
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`matches native linear vignette $args (${mode})`, async ({ space, args: input, hex }) => {
        const end = input.indexOf("-vignette") + 2;
        const args = [...input.slice(0, end), "-format", "%[colorspace]", "-write", "info:", ...input.slice(end)];
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        let stderr = "", stdout = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe(space);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
