import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = encodeImage({
    width: 5, height: 4,
    data: Uint8Array.from({ length: 80 }, (_, i) => i % 4 === 3 ? 255 : (17 + Math.floor(i / 4) * [37, 91, 53][i % 4]!) % 256),
    format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false
}, { format: "png" }).data;

// Native ImageMagick 7.1.2-35 Q16-HDRI, SHA-256 of decoded RGBA8 pixels.
const hashes = {
    "1x2": "f387002f59fd436c98428aa3a82bba4d1ea23abc2a5354d8738115b536ad1c0c",
    "0x2": "ea84809fe04d0a03e62ab5f1f8563cd282be653310518591b9c3f95ae8c74c26",
    "0x1": "d0c30f6b7c9e78be8a19920616891a44ac0bc3441282b52843a5907aa771bf21"
};

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        [[], "%[fx:w-4]x%[fx:h/2]", "1x2"],
        [[], "%[fx:0]x%[fx:h/2]", "0x2"],
        [["-set", "option:strength", "1x2"], "%[strength]", "1x2"],
        [["-set", "strength", "1x2"], "%[strength]", "1x2"],
        [[], "1x2", "1x2"],
        [[], "0x2", "0x2"],
        [[], "0x1", "0x1"]
    ] as const)(`matches native charcoal %j %s via ${mode}`, async (prefix, geometry, literal) => {
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", ...prefix, "-charcoal", geometry, "PNG32:/out.png"];
        if (mode === "command") {
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        }
        const actual = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([actual.width, actual.height]).toEqual([5, 4]);
        expect(createHash("sha256").update(actual.data).digest("hex")).toBe(hashes[literal]);
    });
}
