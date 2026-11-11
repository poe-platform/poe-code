import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync, runMogrifyCli } from "./index.js";

// Red, blue, gray50, black and white; ImageMagick 7.1.2-35 Q16-HDRI reference masks.
const input = encodeImage({ width: 5, height: 1,
    data: Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 255, 127, 127, 127, 255, 0, 0, 0, 255, 255, 255, 255, 255]),
    format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;

for (const mode of ["buffered", "sync", "retained", "command", "mogrify"] as const) {
    it.each([
        ["HSL", [], "black-white", [2, 3, 4]],
        ["CMYK", [], "black-white", [0, 1, 4]],
        ["sRGB", [], "black-white", [0, 1, 2, 3, 4]],
        ["HSL", ["-channel", "R"], "black-white", [0, 2, 3, 4]],
        ["HSL", [], "red-blue", [0, 1]],
        ["CMYK", ["-channel", "RGB"], "black-white", [0, 1, 2, 3, 4]],
        ["CMYK", ["-channel", "K"], "black-white", [0, 1, 4]],
        ["CMYK", ["-channel", "Default"], "black-white", [0, 1, 4]],
    ] satisfies [string, string[], string, number[]][])(`${mode}: classifies %s working samples %j in %s`, async (space, settings, range, white) => {
        const files = new Map([["input.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const operations = ["-colorspace", space, ...settings, "-color-threshold", range];
        const args = ["input.png", ...operations, "-colorspace", "sRGB", "-depth", "8", "rgb:out"];
        let stderr = "";
        const chunks: Uint8Array[] = [];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments([...args.slice(0, -1), "rgb:-"]).args,
            cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : mode === "mogrify" ? await runMogrifyCli([...operations, "input.png"], { filesystem: fs, cwd: "/" })
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? Buffer.concat(chunks)
            : mode === "mogrify" ? decodeImage(await fs.readFile("/input.png")).data.filter((_, index) => index % 4 !== 3)
            : mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect([...output]).toEqual(Array.from({ length: 5 }, (_, index) => Array(3).fill(white.includes(index) ? 255 : 0)).flat());
    });
}
