import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI preserves arithmetic samples before carving.
// A uniform image makes these expectations independent of seam selection.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const geometry of ["3x3!", "6x5!", "5x4!"]) {
        it.each([
            [[], "1"],
            [["-evaluate", "Multiply", "0.25"], "0.25"],
            [["-evaluate", "Subtract", "514"], "-1"],
            [["-evaluate", "Add", "65535"], "256"],
        ] as const)(`${mode}: preserves working samples %j at ${geometry}`, async (before, expected) => {
            const input = Buffer.concat([Buffer.from("P5\n5 4\n255\n"), Buffer.alloc(20, 1)]);
            const files = new Map<string, Uint8Array>([["/grid.pgm", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/grid.pgm", input);
            const argv = ["/grid.pgm", ...before, "-liquid-rescale", geometry,
                "-write", "PNG24:/pixels.png", "-format", "%wx%h/%[fx:p{0,0}.r*255]/%[fx:mean*255]", "info:/out"];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode, stderr).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(new TextDecoder().decode(output)).toBe(`${geometry.slice(0, -1)}/${expected}/${expected}`);
            const pixels = decodeImage(mode === "command" || mode === "retained"
                ? await filesystem.readFile("/pixels.png") : files.get("/pixels.png")!).data;
            const encoded = Math.max(0, Math.min(255, Math.round(Number(expected))));
            expect(Array.from(pixels)).toEqual(Array.from({ length: pixels.length }, (_, i) => i % 4 === 3 ? 255 : encoded));
        });
    }
}
