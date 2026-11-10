import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// 8-bit RGBA PNG with an 8x6 raster and a 25x19-5-3 virtual canvas.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAYAAAD+Bd/7AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjM6MDQ6NTgrMDA6MDAfUTcDAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIzOjA0OjU4KzAwOjAwbgyPvwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMzowNDo1OCswMDowMDkZrmAAAAAQY2FOdgAAABkAAAAT////+/////2qATKzAAAAMklEQVQI12NmUPXKX7rj1N0fXLLrT919zyS7/tCV90wiyw9def5TZPnOM0waBMBgUAAAycsrGr6PfHgAAAAASUVORK5CYII=", "base64");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const [space, diagnostic] of [
        ["madeup", "unrecognized colorspace"],
        ["notgray", "unrecognized colorspace"],
        ["", "unrecognized colorspace"],
        ["DisplayP3", "unsupported colorspace"],
        ["HSB", ""],
        ["hSb", ""],
    ] as const) {
        it(`${mode}: validates '${space}' before replacing the destination`, async () => {
            const sentinel = Buffer.from("sentinel");
            const files = new Map<string, Uint8Array>([["rgba.png", input], ["guard.png", sentinel]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/rgba.png", input);
            await fs.writeFile("/guard.png", sentinel);
            const args = ["rgba.png", "-colorspace", space, "PNG32:guard.png"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} },
                stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/guard.png") : files.get("guard.png")!;
            if (diagnostic) {
                expect({ exitCode: result.exitCode, stderr }).toEqual({
                    exitCode: 1,
                    stderr: expect.stringContaining(`${diagnostic} '${space}'`),
                });
                expect(Array.from(output)).toEqual(Array.from(sentinel));
            } else {
                expect(result.exitCode, stderr).toBe(0);
                expect(stderr).toBe("");
                expect(decodeImage(output).data).toEqual(decodeImage(input).data);
            }
        });
    }
}
