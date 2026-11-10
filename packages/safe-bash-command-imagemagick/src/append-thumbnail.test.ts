import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Two frames with different dimensions and animation controls.
const animation = Buffer.from("R0lGODlhAwACAPAAAPBAEAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQIEQAAACwAAAAAAwACAAACAoRfACH5BAw1AAAALAAAAAACAAUAgBBgwAAAAAIDhI8FADs=", "base64");

// ImageMagick 7.1.2-35 Q16-HDRI uses the first source, not the appended dimensions.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const direction of ["+append", "-append"]) {
        it.each([
            { name: "unequal images", inputs: ["-size", "5x3", "xc:red", "-size", "4x2", "xc:blue"], expected: "5:3:1:./red" },
            { name: "equal images", inputs: ["-size", "5x3", "xc:red", "xc:blue"], expected: "5:3:1:./red" },
            { name: "reversed images", inputs: ["-size", "5x3", "xc:red", "-size", "4x2", "xc:blue", "-reverse"], expected: "4:2:1:./blue" },
            { name: "single image", inputs: ["-size", "5x3", "xc:red"], expected: "5:3:1:./red" },
            { name: "animation", inputs: ["/pair.gif"], expected: "3:2:1:file:///pair.gif" },
        ])(`${mode} ${direction} retains thumbnail source metadata for $name`, async ({ inputs, expected }) => {
            const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/pair.gif", animation]]);
            await filesystem.writeFile("/pair.gif", animation);
            const args = [...inputs, direction, "-thumbnail", "2x2", "-format",
                "%[Thumb::Image::Width]:%[Thumb::Image::Height]:%[Thumb::Document::Pages]:%[Thumb::URI]", "info:-"];
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            if ("stdout" in result && typeof result.stdout === "string") stdout = result.stdout;
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            expect(result.exitCode, stderr).toBe(0);
            expect(stdout).toBe(expected);
            expect(stderr).toBe("");
        });
    }
}
