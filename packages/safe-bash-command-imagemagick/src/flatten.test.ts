import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const reverse of [false, true]) {
        for (const operation of [["-flatten"], ["-layers", "flatten"], ["-mosaic"], ["-layers", "merge"], ["-layers", "mosaic"]]) {
            it(`${mode} ${operation.join(" ")} ${reverse ? "blue first" : "red first"} clips to the appropriate canvas`, async () => {
                const files = new Map<string, Uint8Array>();
                for (const [name, width, height, color] of [
                    ["red.png", 3, 2, [255, 0, 0, 128]],
                    ["blue.png", 2, 3, [0, 0, 255, 128]]
                ] as const) {
                    files.set(name, await sharp(Uint8Array.from(Array.from({ length: width * height }, () => [...color]).flat()), { raw: { width, height, channels: 4 } }).png().toBuffer());
                }
                const fs = new MemoryFileSystem();
                for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
                const inputs = reverse ? ["blue.png", "red.png"] : ["red.png", "blue.png"];
                const args = [...inputs, "-background", "white", ...operation, "out.png"];
                const result = mode === "sync" ? runConvertCliSync(args, files)
                    : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                const image = decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
                const flatten = operation.includes("-flatten") || operation.includes("flatten");
                expect([image.width, image.height]).toEqual(flatten ? reverse ? [2, 3] : [3, 2] : [3, 3]);
                for (let y = 0; y < image.height; y++) {
                    for (let x = 0; x < image.width; x++) {
                        const expected = x < 2 && y < 2 ? reverse ? [191, 63, 127, 255] : [127, 63, 191, 255]
                            : y < 2 ? [255, 127, 127, 255] : x < 2 ? [127, 127, 255, 255] : [255, 255, 255, 255];
                        expect([...image.data.subarray((y * image.width + x) * 4, (y * image.width + x + 1) * 4)]).toEqual(expected);
                    }
                }
            });
        }
    }
}
