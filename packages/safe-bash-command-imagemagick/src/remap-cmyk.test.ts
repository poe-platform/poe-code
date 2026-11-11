import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n8 4\n255\n"), Buffer.from(Array.from({ length: 96 }, (_, i) => (13 * i + 9) % 256))]);
const palette = Buffer.concat([Buffer.from("P6\n4 1\n255\n"), Buffer.from("000000ff000000ff00ffffff", "hex")]);

// Native ImageMagick Q16-HDRI: remapping keeps CMYK active and selects four colors.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const [dither, hash] of [
        [["+dither"], "28dd10cdfcfc3824a9a1b743c1a61d28cef3064ea02b02b06d474e9f087dc7f6"],
        [["-dither", "FloydSteinberg"], "800ce60216824d1e7a423d4cfc3012f5a90d35b5fd8576fc9b25ba3350d68e8e"],
        [["-dither", "Riemersma"], "94eed5e34439bd688958ca6d50bdb55324e9f730cf4170b8cd5547404b32c48d"]
    ] as const) for (const srgb of [false, true]) {
        it.each(["raw", "count"])(`${mode}: remapped CMYK %s (${dither.join(" ")}, sRGB=${srgb})`, async output => {
            const files = new Map<string, Uint8Array>([["in.ppm", input], ["pal.ppm", palette]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const argv = ["in.ppm", "-colorspace", "CMYK", ...dither, "-remap", "pal.ppm",
                ...(srgb ? ["-colorspace", "sRGB"] : []),
                ...(output === "raw" ? ["-depth", "8", "rgba:/out"] : ["-format", "%[colorspace]|%k", "info:/out"])];
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            if (output === "count") expect(Buffer.from(bytes).toString()).toBe(`${srgb ? "sRGB" : "CMYK"}|4`);
            else {
                expect(bytes.length).toBe(128);
                expect(Buffer.from(bytes.subarray(0, 4)).toString("hex")).toBe("000000ff");
                expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
            }
        });
    }
}
