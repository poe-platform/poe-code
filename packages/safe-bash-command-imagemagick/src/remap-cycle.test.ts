import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI keeps the full remap colormap,
// including unused colors, in red/green/blue order for subsequent cycling.
const palette = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAIAAACUgoPjAAAADklEQVR4nGP4z8DAAMYADvsC/gkcFjQAAAAASUVORK5CYII=", "base64");
const indexed = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEX/AAAA/wAAAP///wDWAo97AAAADUlEQVR4nGNgYGRiBgAADwAHhI6ZbQAAAABJRU5ErkJggg==", "base64");
const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const dither of [["+dither"], ["-dither", "FloydSteinberg"], ["-dither", "Riemersma"]]) {
        for (const { input, indices } of [
            { input: "/palette.png", indices: [0, 1, 2] },
            { input: "xc:red", indices: [0] },
            { input: "/indexed.png", indices: [0, 1, 2, 1] }
        ]) for (const shifts of [[], [1], [-1], [1, -1]]) {
            it(`${mode}: retains the remap palette for ${input}, ${dither.join(" ")}, cycles ${shifts}`, async () => {
                const files = new Map<string, Uint8Array>([["/palette.png", palette], ["/indexed.png", indexed]]), fs = new MemoryFileSystem();
                for (const [name, bytes] of files) await fs.writeFile(name, bytes);
                const argv = [input, ...dither, "-remap", "/palette.png", ...shifts.flatMap(shift => ["-cycle", String(shift)]),
                    "-write", "PNG64:/out.png", "-format", "%r|%k", "info:"];
                let stdout = "", stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }) : mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
                const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
                const shift = shifts.reduce((sum, value) => sum + value, 0);
                expect([...output.data16!]).toEqual(indices.flatMap(index => colors[(index + shift + 3) % 3]!.map(value => value * 257)));
                expect(("stdout" in result && typeof result.stdout === "string" ? result.stdout : stdout).trim()).toBe(`PseudoClass sRGB |${new Set(indices).size}`);
            });
        }
    }
}
