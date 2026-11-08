import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createImagemagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    for (const angle of ["90>", "90<", "90", "30>", "30<"]) {
        it(`evaluates ${angle} separately for each image (${mode})`, async () => {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const sizes = [[4, 2], [2, 4], [2, 2]] as const;
            for (const [i, [width, height]] of sizes.entries()) {
                const data = Uint8Array.from({ length: width * height * 3 }, (_, j) => 10 + Math.floor(j / 3) * 30);
                const input = await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
                files.set(`/in${i}.png`, input);
                await filesystem.writeFile(`/in${i}.png`, input);
            }
            const args = [...files.keys(), "-rotate", angle, "/out-%d.png"];
            const result = mode === "public" ? await createImagemagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async () => {} },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            for (const [i, [width, height]] of sizes.entries()) {
                const output = decodeImage(mode === "public" || mode === "retained" ? await filesystem.readFile(`/out-${i}.png`) : files.get(`/out-${i}.png`)!);
                const rotate = angle.endsWith(">") ? width > height : angle.endsWith("<") ? width < height : true;
                if (rotate && angle.startsWith("30")) {
                    const expectedFiles = new Map([["/in.png", files.get(`/in${i}.png`)!]]);
                    expect(runConvertCliSync(["/in.png", "-rotate", "30", "/expected.png"], expectedFiles).exitCode).toBe(0);
                    const expected = decodeImage(expectedFiles.get("/expected.png")!);
                    expect([output.width, output.height]).toEqual([expected.width, expected.height]);
                    expect(output.data).toEqual(expected.data);
                } else {
                    expect([output.width, output.height]).toEqual(rotate ? [height, width] : [width, height]);
                    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                        const target = rotate ? x * height + height - 1 - y : y * width + x;
                        const value = 10 + (y * width + x) * 30;
                        expect([...output.data.slice(target * 4, target * 4 + 4)]).toEqual([value, value, value, 255]);
                    }
                }
            }
        });
    }
}
