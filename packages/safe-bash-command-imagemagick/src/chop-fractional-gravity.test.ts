import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 PNG64 grid: red = pixel ID * 1000 + 1.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAUAAAAEEAYAAAAWoykDAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTY6Mzc6NDQrMDA6MDAHwBYjAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE2OjM3OjQ0KzAwOjAwdp2unwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxNjozNzo0NCswMDowMCGIj0AAAAApSURBVAjXY2RgdFZcffb/f+YXDAwMDAwMLLho4Q4oo4OAQhGoAqqZCABkBhO5+gjh9AAAAABJRU5ErkJggg==", "base64");
const original = decodeImage(input);

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["Center", "+0.5+0.5", [0, 3, 4, 10, 13, 14, 15, 18, 19]],
        ["Center", "+0+0", [0, 3, 4, 10, 13, 14, 15, 18, 19]],
        ["Center", "+1+1", [0, 1, 4, 5, 6, 9, 15, 16, 19]],
        ["SouthEast", "+0.5+0.5", [0, 1, 2, 5, 6, 7, 10, 11, 12]],
        ["SouthEast", "+0+0", [0, 1, 2, 5, 6, 7, 10, 11, 12]],
        ["SouthEast", "+1+1", [0, 1, 4, 5, 6, 9, 15, 16, 19]],
        ["NorthWest", "+0.5+0.5", [7, 8, 9, 12, 13, 14, 17, 18, 19]],
        ["NorthWest", "+0+0", [7, 8, 9, 12, 13, 14, 17, 18, 19]],
        ["NorthWest", "+1+1", [0, 3, 4, 10, 13, 14, 15, 18, 19]],
        ["Center", "-0.5-0.5", [0, 3, 4, 10, 13, 14, 15, 18, 19]],
        ["SouthEast", "-0.5-0.5", [0, 1, 2, 5, 6, 7, 10, 11, 12]],
        ["Center", "+1.5+1.5", [0, 1, 4, 5, 6, 9, 15, 16, 19]],
        ["SouthEast", "+1.5+1.5", [0, 1, 4, 5, 6, 9, 15, 16, 19]],
        ["Center", "-1.5-1.5", [7, 8, 9, 12, 13, 14, 17, 18, 19]],
    ] as const)(`retains native pixels for %s chop 2x1%s (${mode})`, async (gravity, offset, ids) => {
        const files = new Map<string, Uint8Array>([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-gravity", gravity, "-chop", `2x1${offset}`, "PNG64:/output.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
        const output = decodeImage(bytes);
        expect([output.width, output.height]).toEqual([3, 3]);
        expect(runMagickCliSync(["identify", "-format", "%wx%h %g", "/output.png"], new Map([["/output.png", bytes]])).stdout).toBe("3x3 3x3+0+0");
        expect(Array.from(output.data16!)).toEqual(ids.flatMap(id => Array.from(original.data16!.subarray(id * 4, id * 4 + 4))));
    });
}
