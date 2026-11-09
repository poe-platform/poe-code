import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { initial: 45455, options: [], gamma: 45455, pixels: [200, 240, 250, 255] },
        { initial: 45455, options: ["-gamma", "2"], gamma: 90909, pixels: [226, 247, 252, 255] },
        { initial: 45455, options: ["-gamma", "0.1"], gamma: 4545, pixels: [22, 139, 209, 255] },
        { initial: 60000, options: ["-gamma", "2"], gamma: 120000, pixels: [226, 247, 252, 255] },
        { initial: 60000, options: ["-gamma", "2", "-gamma", "0.5"], gamma: 60000, pixels: [200, 240, 250, 255] }
    ])("preserves native PNG gamma and pixels $options via " + mode, async ({ initial, options, gamma, pixels }) => {
        const png = await sharp(Uint8Array.of(200, 240, 250), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
        const chunk = Buffer.from(initial === 45455 ? "0000000467414d410000b18f0bfc6105" : "0000000467414d410000ea6062061a73", "hex");
        const input = new Uint8Array(png.length + 16);
        input.set(png.subarray(0, 33));
        input.set(chunk, 33);
        input.set(png.subarray(33), 49);
        const files = new Map([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", ...options, "/output.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
        expect([...decodeImage(output).data]).toEqual(pixels);
        const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
        let actual: number | undefined;
        for (let pos = 8; pos + 12 <= output.length; pos += view.getUint32(pos) + 12) {
            if (String.fromCharCode(...output.subarray(pos + 4, pos + 8)) === "gAMA") actual = view.getUint32(pos + 8);
        }
        expect(actual).toBe(gamma);
    });
}
