import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native PNG64 5x4 grid: red = pixel index * 1000 + 1.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAUAAAAEEAYAAAAWoykDAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTY6Mzc6NDQrMDA6MDAHwBYjAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE2OjM3OjQ0KzAwOjAwdp2unwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxNjozNzo0NCswMDowMCGIj0AAAAApSURBVAjXY2RgdFZcffb/f+YXDAwMDAwMLLho4Q4oo4OAQhGoAqqZCABkBhO5+gjh9AAAAABJRU5ErkJggg==", "base64");
const source = decodeImage(input);
const original = Array.from({ length: 20 }, (_, i) => i);

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const gravity of ["NorthWest", "Center", "SouthEast"]) {
        it.each([
            ["2x1+0+0<", 5, 4, original, true],
            ["2x1+1+1<", 5, 4, original, true],
            ["40x25%<", 5, 4, original, true],
            ...(gravity === "NorthWest" ? [
                ["2x0+0+0<", 3, 4, [2, 3, 4, 7, 8, 9, 12, 13, 14, 17, 18, 19], false],
                ["0x1+0+0<", 5, 3, original.slice(5), false],
                ["5x1-3+0<", 3, 3, [7, 8, 9, 12, 13, 14, 17, 18, 19], false],
                ["6x1-4+0<", 3, 3, [7, 8, 9, 12, 13, 14, 17, 18, 19], false],
            ] as const : []),
            ["2x1+0+0", 3, 3, gravity === "NorthWest" ? [7, 8, 9, 12, 13, 14, 17, 18, 19] : gravity === "Center" ? [0, 3, 4, 10, 13, 14, 15, 18, 19] : [0, 1, 2, 5, 6, 7, 10, 11, 12], false],
            ["2x1+0+0>", 3, 3, gravity === "NorthWest" ? [7, 8, 9, 12, 13, 14, 17, 18, 19] : gravity === "Center" ? [0, 3, 4, 10, 13, 14, 15, 18, 19] : [0, 1, 2, 5, 6, 7, 10, 11, 12], false],
        ] as const)(`honors chop %s at ${gravity} (${mode})`, async (geometry, width, height, ids, warns) => {
            const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const args = ["/input.png", "-gravity", gravity, "-chop", geometry, "/output.png"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
            const output = decodeImage(bytes);
            expect([output.width, output.height]).toEqual([width, height]);
            expect(output.data16).toEqual(Uint16Array.from(ids.flatMap(id => Array.from(source.data16!.subarray(id * 4, id * 4 + 4)))));
            expect("stderr" in result ? result.stderr : stderr).toBe(warns ? `magick: geometry does not contain image '${geometry}'\n` : "");
            const outputFiles = new Map([["/output.png", bytes]]);
            expect(runMagickCliSync(["identify", "-format", "%wx%h %g", "/output.png"], outputFiles).stdout).toBe(`${width}x${height} ${width}x${height}+0+0`);
        });
    }
}
