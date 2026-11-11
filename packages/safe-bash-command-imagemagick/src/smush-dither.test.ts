import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, decoded PNG32 pixels; all other pixels are opaque white.
const cases = [
    { operation: "-smush", gravity: "NorthWest", method: "Dither", width: 4, height: 5, red: [3, 1], blue: [1, 4] },
    { operation: "-smush", gravity: "SouthEast", method: "Dither", width: 4, height: 4, red: [3, 1], blue: [3, 3] },
    { operation: "-smush", gravity: "NorthWest", method: "Edge", width: 4, height: 3, red: [3, 1], blue: [1, 2] },
    { operation: "-smush", gravity: "SouthEast", method: "Edge", width: 4, height: 3, red: [3, 1], blue: [3, 2] },
    { operation: "+smush", gravity: "NorthWest", method: "Dither", width: 5, height: 4, red: [3, 1], blue: [4, 3] },
    { operation: "+smush", gravity: "SouthEast", method: "Dither", width: 5, height: 4, red: [3, 3], blue: [4, 3] },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode} $operation $gravity $method uses both virtual pixel coordinates`, async ({ operation, gravity, method, width, height, red, blue }) => {
        const argv = [
            "(", "-size", "4x2", "xc:none", "-fill", "red", "-draw", "point 3,1", ")",
            "(", "-size", "2x4", "xc:none", "-fill", "blue", "-draw", "point 1,3", ")",
            "-gravity", gravity, "-virtual-pixel", method, operation, "0",
            "-write", "PNG32:out.png", "-format", "%wx%h", "info:",
        ];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(`${width}x${height}`);
        const image = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([image.width, image.height]).toEqual([width, height]);
        const pixels = new Uint8Array(width * height * 4).fill(255);
        pixels.set([255, 0, 0, 255], (red[1]! * width + red[0]!) * 4);
        pixels.set([0, 0, 255, 255], (blue[1]! * width + blue[0]!) * 4);
        expect(image.data).toEqual(pixels);
    });
}
