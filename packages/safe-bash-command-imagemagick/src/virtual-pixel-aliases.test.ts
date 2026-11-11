import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P6\n4 3\n255\n"),
    Buffer.from(Array.from({ length: 36 }, (_, i) => (13 * i + 9) % 256))
]);

// ImageMagick 7.1.2-35 Q16-HDRI: -seed 123 -background '#cc1177'
// -virtual-pixel METHOD -splice 2x2-2-2 -depth 8 rgb:out.bin.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["HorizontalTile", "horizontal-tile", "6ca0e55b83d1b11a5366549db73b4de6b0819a6cd9e33af2cac3504a18fed236"],
        ["VerticalTile", "vertical-tile", "c9082672f5626073d30724ccb8357a8039c8805759565ebadae94fb3275ae6bc"],
        ["HorizontalTileEdge", "horizontal-tile-edge", "9d027665b3e83756fd4195710c76b0acbf86756239da4d40f1f2ff8a8a2a5687"],
        ["VerticalTileEdge", "vertical-tile-edge", "6f624180af55029f08ef7450516907f69cb8dea468d0bc4e98062a2d8ba7d25c"],
        ["CheckerTile", "checker-tile", "138b6d0965e0f4bde2c58c75bc97e07e8d324485cd16420388eb4286b4f9967b"]
    ])(`${mode}: accepts %s and its hyphenated spelling`, async (native, hyphenated, hash) => {
        let reference: Uint8Array | undefined;
        for (const method of [hyphenated, native, native.toLowerCase(), native.toUpperCase()]) {
            const files = new Map<string, Uint8Array>([["in.ppm", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const args = ["in.ppm", "-seed", "123", "-background", "#cc1177", "-virtual-pixel", method,
                "-splice", "2x2-2-2", "-depth", "8", "rgb:out.bin"];
            let stderr = "";
            const argumentValues = createCommandArguments(args);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect("stderr" in result ? result.stderr : stderr, method).toBe("");
            expect(result.exitCode, method).toBe(0);
            const output = mode === "buffered" || mode === "sync" ? files.get("out.bin")! : await fs.readFile("/out.bin");
            expect(output.byteLength).toBe(6 * 5 * 3);
            expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
            if (reference) expect(output).toEqual(reference);
            else reference = output;
        }
    });
}
