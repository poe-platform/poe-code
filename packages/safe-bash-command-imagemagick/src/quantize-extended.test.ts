import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference samples and RGB8 bytes.
for (const mode of ["sync", "public"] as const) {
    async function execute(args: string[], input?: Uint8Array) {
        const files = new Map<string, Uint8Array>(input ? [["/in.ppm", input]] : []);
        const fs = new MemoryFileSystem();
        if (input) await fs.writeFile("/in.ppm", input);
        let stderr = "";
        const result = mode === "sync" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        return mode === "sync" ? files.get("/out")! : fs.readFile("/out");
    }

    for (const [value, expected] of [["150%", "0.75098,0.25098,0.25098"], ["-50%", "0.25098,0.25098,0.25098"]]) {
        it(`bounds ${value} palette samples (${mode})`, async () => {
            const bytes = await execute(["(", "xc:black", "-channel", "R", "-evaluate", "set", value!, "+channel", ")", "xc:#808080", "+append", "+dither", "-colors", "1", "-format", "%k|%[fx:r],%[fx:g],%[fx:b]", "info:/out"]);
            expect(new TextDecoder().decode(bytes)).toBe(`1|${expected}`);
        });
        it(`preserves unquantized ${value} samples (${mode})`, async () => {
            const bytes = await execute(["xc:black", "-channel", "R", "-evaluate", "set", value!, "+channel", "-format", "%[fx:r]", "info:/out"]);
            expect(new TextDecoder().decode(bytes)).toBe(value === "150%" ? "1.50002" : "-0.500008");
        });
    }
    for (const [space, colors, expected] of [
        ["XYZ", ["xc:white", "xc:#abcfff"], "dee8f8dee8f8"],
        ["CAT02LMS", ["xc:white", "xc:#abcfff"], "dee8f8dee8f8"],
        ["LMS", ["xc:white", "xc:#abcfff"], "dee6f8dee6f8"],
        ["ProPhoto", ["xc:red", "xc:blue"], "c30089c30089"],
        ["OKLCH", ["xc:#c1ec17"], "ffad0f"],
    ] as const) {
        it(`bounds ${space} working palette samples (${mode})`, async () => {
            const bytes = await execute([...colors, "+append", "-colorspace", space, "-quantize", space, "+dither", "-colors", "1", "-colorspace", "sRGB", "-depth", "8", "rgb:/out"]);
            expect(Buffer.from(bytes).toString("hex")).toBe(expected);
        });
    }
    for (const [dither, count, hash] of [
        ["None", "4", "57bf8f2faf8f7d7bd86567db964cc607144997ce36c63d72ddb62dacd7ae2a40"],
        ["FloydSteinberg", "5", "b546702b2cb9679930e5308dc752ddf0e834ff88fe1e495d68b4381d7fe7355b"],
        ["Riemersma", "5", "50441c0565a3ce999806e3dfbff377cd909cc16b6ec46f46a6b96984aa63842a"],
    ]) {
        it(`bounds XYZ gradient samples with ${dither} (${mode})`, async () => {
            const input = Buffer.concat([Buffer.from("P6\n17 9\n255\n"), Buffer.from(Array.from({ length: 17 * 9 * 3 }, (_, i) => (Math.floor(i / 3) % 17 * 11 + Math.floor(i / 51) * 7 + i % 3 * 43) % 256))]);
            const args = ["/in.ppm", "-quantize", "XYZ", "-dither", dither!, "-colors", "5"];
            expect(new TextDecoder().decode(await execute([...args, "-format", "%k", "info:/out"], input))).toBe(count);
            expect(createHash("sha256").update(await execute([...args, "-depth", "8", "rgb:/out"], input)).digest("hex")).toBe(hash);
        });
    }
}
