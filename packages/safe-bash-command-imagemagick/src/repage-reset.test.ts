import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

for (const mode of ["public", "sync"] as const) {
    it.each([
        [["+repage"], "0x0+0+0", false],
        [["-repage", "7x4+2+1", "+repage"], "0x0+0+0", false],
        [["+repage", "-repage", "+2+1"], "5x3+2+1", true],
        [["-repage", "7x4+2+1", "+repage", "-repage", "+2+1"], "5x3+2+1", true],
        [["-repage", "0x0+0+0", "-repage", "+2+1"], "5x3+2+1", true],
    ] as const)(`resets the working canvas for %j (${mode})`, async (options, page, offset) => {
        const input = await sharp(Uint8Array.from([
            255, 0, 0, 0, 255, 0, 0, 0, 255,
            255, 255, 0, 0, 255, 255, 255, 0, 255
        ]), { raw: { width: 3, height: 2, channels: 3 } }).png().toBuffer();
        for (const outputKind of ["info", "flatten", "png"] as const) {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/input.png", input);
            await fs.writeFile("/out.png", new TextEncoder().encode("KEEP"));
            const files = new Map<string, Uint8Array>([["/input.png", input], ["/out.png", new TextEncoder().encode("KEEP")]]);
            const args = ["/input.png", ...options, ...(outputKind === "info"
                ? ["-format", "%wx%h|%g", "info:"]
                : [...(outputKind === "flatten" ? ["-background", "black", "-flatten"] : []), "PNG32:/out.png"])];
            const argumentValues = createCommandArguments(args);
            let stdout = "";
            const result = mode === "public" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                stderr: { async write() {} }
            }) : runConvertCliSync(args, files);
            expect(result.exitCode).toBe(0);
            if (outputKind === "info") {
                expect("stdout" in result ? result.stdout : stdout).toBe(`3x2|${page}`);
                continue;
            }
            const bytes = mode === "public" ? await fs.readFile("/out.png") : files.get("/out.png")!;
            const output = decodeImage(bytes);
            const expanded = outputKind === "flatten" && offset;
            expect([output.width, output.height]).toEqual(expanded ? [5, 3] : [3, 2]);
            const metadata = runConvertCliSync(["/out.png", "-format", "%wx%h|%g", "info:"], new Map([["/out.png", bytes]]));
            expect(metadata.exitCode).toBe(0);
            expect(metadata.stdout).toBe(`${output.width}x${output.height}|${outputKind === "png" && offset ? page : `${output.width}x${output.height}+0+0`}`);
            expect({ width: output.virtualCanvas?.width || output.width, height: output.virtualCanvas?.height || output.height,
                x: output.virtualCanvas?.x ?? 0, y: output.virtualCanvas?.y ?? 0 }).toEqual(outputKind === "png" && offset
                ? { width: 5, height: 3, x: 2, y: 1 }
                : { width: output.width, height: output.height, x: 0, y: 0 });
            const original = decodeImage(input);
            const expected = expanded ? Uint8Array.from({ length: 60 }, (_, i) => i % 4 === 3 ? 255 : 0) : original.data.slice();
            if (expanded) for (let y = 0; y < 2; y++) expected.set(original.data.subarray(y * 12, (y + 1) * 12), ((y + 1) * 5 + 2) * 4);
            expect(output.data).toEqual(expected);
        }
    });
}
