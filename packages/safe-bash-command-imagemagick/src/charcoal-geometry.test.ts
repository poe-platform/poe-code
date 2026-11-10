import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: 5x4 RGB pixels (17 + pixel * channel) % 256.
const cases = [
    { geometries: ["1/2", "1,2", "1x2"], hash: "f387002f59fd436c98428aa3a82bba4d1ea23abc2a5354d8738115b536ad1c0c" },
    { geometries: ["0x1"], hash: "d0c30f6b7c9e78be8a19920616891a44ac0bc3441282b52843a5907aa771bf21" },
    { geometries: ["1,1", "1x1"], hash: "9560cf5fde0a9e6b705a9ac3599ec8ceaa3a49cdfcf3c9be2077172a89de9915" },
].flatMap(({ geometries, hash }) => geometries.map(geometry => ({ geometry, hash })));

for (const mode of ["magick", "sync"] as const) {
    it.each(cases)(`${mode}: matches native charcoal $geometry`, async ({ geometry, hash }) => {
        const data = Uint8Array.from({ length: 5 * 4 * 4 }, (_, i) =>
            i % 4 === 3 ? 255 : (17 + Math.floor(i / 4) * [37, 91, 53][i % 4]!) % 256);
        const input = encodeImage({ width: 5, height: 4, data, format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
        const files = new Map([["/input.png", input], ["/out.png", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/input.png", "-charcoal", geometry, "PNG32:/out.png"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runConvertCliSync(argv, files) : { ...await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stderr };
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        const output = decodeImage(mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
        expect([output.width, output.height]).toEqual([5, 4]);
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
    });
}
