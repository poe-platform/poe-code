import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const option of ["-sample", "-resize", "-scale", "-thumbnail"]) {
        it.each(["1:1", "3:2", "2:1", "1:2"])(`${mode} ${option} honors aspect ratio %s`, async geometry => {
            const pixels = Array.from({ length: 24 }, (_, i) => (i + 1) * 10);
            const input = await sharp(Uint8Array.from(pixels.flatMap(v => [v, v, v])), { raw: { width: 6, height: 4, channels: 3 } }).png().toBuffer();
            const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const args = ["input.png", option, geometry, "out.png"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
            const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            const dimensions = geometry === "1:1" ? [4, 4] : geometry === "3:2" ? [6, 4] : geometry === "2:1" ? [6, 3] : [2, 4];
            expect([output.width, output.height]).toEqual(dimensions);
            if (geometry === "3:2") expect([...output.data]).toEqual(pixels.flatMap(v => [v, v, v, 255]));
            // Native ImageMagick 7.1.2 Q16-HDRI samples all four rows, not a center crop.
            if (geometry === "1:1" && option === "-sample") {
                expect([...output.data]).toEqual([10, 30, 40, 60, 70, 90, 100, 120, 130, 150, 160, 180, 190, 210, 220, 240].flatMap(v => [v, v, v, 255]));
            }
        });
    }
}
