import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, two 4x3 RGBA images, +append, 8-bit RGBA output.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["%[fx:n*80]", "5f0d3633b16828644831420b25895ef7137a9444dff8bef94e9896a68378bbf4"],
        ["%[fx:t*80]", "93fd522d34a31fefe076b03b24da3d8cea333e0243a3eb94278f043bf2f66dd9"],
        ["%[fx:u[1].r*255]", "1bd546c35263fe118696adfe27c9102c5fb007b36b2932cd8ba07fde3cfb2450"],
        ["160", "5f0d3633b16828644831420b25895ef7137a9444dff8bef94e9896a68378bbf4"],
        ["80", "772f82bcbb4fc88fe0f086d9653eeb4a6e4e358799bffade3ac220a7c290b4ca"],
        ["%[option:v]", "5f0d3633b16828644831420b25895ef7137a9444dff8bef94e9896a68378bbf4"],
    ])(`evaluates swirl angle %s against the full sequence via ${mode}`, async (angle, hash) => {
        const files = new Map<string, Uint8Array>([["/out", new TextEncoder().encode("KEEP")]]);
        for (const name of ["o", "a"]) {
            files.set(`/${name}.raw`, Uint8Array.from({ length: 4 * 3 * 4 }, (_, i) => {
                const pixel = Math.floor(i / 4), channel = i % 4;
                return channel === 3 ? name === "a" ? [0, 96, 160, 255][pixel % 4]! : 255
                    : (pixel * [31, 73, 47][channel]! + [20, 80, 13][channel]!) % 256;
            }));
        }
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["-size", "4x3", "-depth", "8", "rgba:/o.raw", "-size", "4x3", "-depth", "8", "rgba:/a.raw", "-set", "option:v", "160", "-swirl", angle, "+append", "-depth", "8", "rgba:/out"];
        if (mode === "command") {
            const arguments_ = createCommandArguments(args);
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: arguments_.args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            });
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        }
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output).toHaveLength(96);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
