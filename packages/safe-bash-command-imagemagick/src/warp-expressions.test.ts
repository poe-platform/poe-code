import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["-swirl", "%[fx:60*2]", "120"],
        ["-implode", "%[fx:3/2]", "1.5"],
        ["-wave", "%[fx:1+1]x8", "2x8"],
        ["-swirl", "%[fx:w*10+h]", "97"],
        ["-implode", "%[fx:w/h]", String(9 / 7)],
        ["-wave", "%[fx:h-5]x%[fx:w-1]", "2x8"],
    ])(`expands %s %s before warping via ${mode}`, async (option, expression, literal) => {
        const pixels = Uint8Array.from({ length: 9 * 7 * 4 }, (_, i) =>
            i % 4 === 3 ? 255 : (Math.floor(i / 4) * [37, 91, 53][i % 4]! + 17) % 256);
        const input = await sharp(pixels, { raw: { width: 9, height: 7, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        for (const [value, path] of [[literal, "/literal.png"], [expression, "/expression.png"]]) {
            const args = ["/input.png", option!, value!, `PNG32:${path}`];
            if (mode === "command") {
                const arguments_ = createCommandArguments(args);
                let stderr = "";
                const result = await createMagickCommand().execute({
                    command: "magick", args: arguments_.args, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write() {} }, stderr: { async write(chunk) { stderr += chunk; } },
                });
                expect(result.exitCode, stderr).toBe(0);
                continue;
            }
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        }
        const literalImage = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/literal.png") : files.get("/literal.png")!);
        const expressionImage = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/expression.png") : files.get("/expression.png")!);
        expect([expressionImage.width, expressionImage.height]).toEqual([9, option === "-wave" ? 11 : 7]);
        expect(expressionImage.data).toEqual(literalImage.data);
    });
}
