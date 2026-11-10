import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

const data = Uint8Array.from({ length: 80 }, (_, i) => i % 4 === 3 ? 255 : (17 + Math.floor(i / 4) * [37, 91, 53][i % 4]!) % 256);
const input = encodeImage({ width: 5, height: 4, data, format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
// Native ImageMagick 7.1.2-31 Q16-HDRI, matching the 7.1.2-35 issue oracle.
const cases: [string, number[]][] = [
    ["0x1", [62435, 52751, 31313, 14625, 3343, 16888, 24016, 18894, 19276, 31558, 7773, 15318, 20735, 24312, 32313, 42200, 34581, 37943, 29408, 10824]],
    ["2", [62380, 53043, 31375, 14618, 3324, 16305, 23643, 18662, 19395, 32246, 7017, 14748, 20528, 24546, 33302, 41731, 34432, 38201, 29761, 11549]],
    ["1x0", [65535, 65535, 18667, 53894, 14596, 4731, 51599, 65535, 18667, 62585, 65535, 4731, 51599, 0, 60804, 65535, 18166, 65034, 42832, 4731]]
];
for (const mode of ["public", "sync"]) {
    it.each([...cases.map(([geometry, expected]) => ({ geometry, expected, format: "PNG64", hash: "" })),
        { geometry: "0x1", expected: [], format: "PNG32", hash: "d0c30f6b7c9e78be8a19920616891a44ac0bc3441282b52843a5907aa771bf21" },
        { geometry: "", expected: [], format: "PNG64", hash: "320820e1fbcb0a38a381a40c58afb358a4a94e668c3fb95deb2591b60a4d727f" }
    ])(`preserves native charcoal $geometry precision in $format (${mode})`, async ({ geometry, expected, format, hash }) => {
        const fs = new MemoryFileSystem();
        const files = new Map([["/input.png", input], ["/out.png", new TextEncoder().encode("KEEP")]]);
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/input.png", ...(geometry ? ["-charcoal", geometry] : []), `${format}:/out.png`];
        const argumentValues = createCommandArguments(args);
        const context = {
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
        } as unknown as CommandContext;
        const result = mode === "public" ? await createMagickCommand().execute(context) : runConvertCliSync(args, files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = decodeImage(mode === "public" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        if (expected.length) expect(Array.from(output.data16!)).toEqual(expected.flatMap(value => [value, value, value, 65535]));
        else {
            const bytes = format === "PNG32" ? output.data : Uint8Array.from(Array.from(output.data16!).flatMap(value => [value >>> 8, value & 255]));
            expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
        }
    });
}
