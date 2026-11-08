import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;

for (const mode of ["sync", "buffered", "retained", "public"] as const) {
    it.each(["+2+1", "+0+0"])(`uses each source's dimensions for offset-only frames, ${mode}: %s`, async geometry => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        for (const [width, height] of [[10, 8], [7, 5]] as const) {
            const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) + 1);
            const input = encodeImage({ width, height, data, format: "png", depth: "uchar", density: 72, channels: 4, space: "srgb", hasAlpha: false }, { format: "png" }).data;
            files.set(`${width}.png`, input);
            await filesystem.writeFile(`/${width}.png`, input);
        }
        const args = ["10.png", "7.png", "-mattecolor", "red", "-frame", geometry, "out-%d.png"];
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
        for (const [index, [width, height]] of ([[10, 8], [7, 5]] as const).entries()) {
            const output = mode === "retained" || mode === "public" ? await filesystem.readFile(`/out-${index}.png`) : files.get(`out-${index}.png`)!;
            const actual = decodeImage(output);
            expect([actual.width, actual.height]).toEqual([width * 3, height * 3]);
            const reference = runConvertCliSync([`${width}.png`, "-mattecolor", "red", "-frame", `${width}x${height}${geometry}`, "png:-"], files);
            expect(reference.exitCode, reference.stderr).toBe(0);
            expect(actual.data).toEqual(decodeImage(reference.stdoutBytes!).data);
            if (nativeAvailable) {
                const native = spawnSync("magick", ["png:-", "-mattecolor", "red", "-frame", geometry, "-depth", "8", "png:-"], { input: files.get(`${width}.png`)! });
                expect(native.status, native.stderr.toString()).toBe(0);
                const expected = decodeImage(native.stdout);
                expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
                expect(Math.max(...actual.data.map((value, i) => Math.abs(value - expected.data[i]!)))).toBeLessThanOrEqual(1);
            }
        }
    });
}
