import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;

for (const mode of ["sync", "buffered", "retained", "public"] as const) {
    it.each([
        [10, 8, "30x25+5+4", "2x2", "14x12 34x29+5+4"],
        [7, 5, "28x22+4+3", "3x1", "13x7 34x24+4+3"],
        [10, 8, "30x25-5-4", "2x2", "14x12 34x29-5-4"],
    ] as const)(`expands the frame canvas and preserves its origin (${mode}): %s x %s, %s, %s`, async (width, height, page, frame, expected) => {
        const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) + 1);
        const input = encodeImage({ width, height, data, format: "png", depth: "uchar", density: 72, channels: 4, space: "srgb", hasAlpha: false }, { format: "png" }).data;
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", "-mattecolor", "red", "-repage", page, "-frame", frame, "/out.png"];
        if (mode === "public") {
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const context = {
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} },
                stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
                registerCleanup() {}, fs: filesystem,
            } as unknown as CommandContext;
            expect((await createMagickCommand().execute(context)).exitCode, stderr).toBe(0);
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode, result.stderr).toBe(0);
        }
        const output = mode === "retained" || mode === "public" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        const actual = decodeImage(output), canvas = actual.virtualCanvas!;
        const offset = (value: number) => value < 0 ? String(value) : `+${value}`;
        expect(`${actual.width}x${actual.height} ${canvas.width}x${canvas.height}${offset(canvas.x)}${offset(canvas.y)}`).toBe(expected);
        if (nativeAvailable) {
            const identified = spawnSync("magick", ["identify", "-format", "%wx%h %Wx%H%X%Y", "png:-"], { input: output });
            expect(identified.status, identified.stderr.toString()).toBe(0);
            expect(identified.stdout.toString()).toBe(expected);
            const native = spawnSync("magick", ["png:-", ...args.slice(1, -1), "png:-"], { input });
            expect(native.status, native.stderr.toString()).toBe(0);
            expect(actual.data).toEqual(decodeImage(native.stdout).data);
        }
    });
}
