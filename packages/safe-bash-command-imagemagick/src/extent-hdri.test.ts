import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([false, true])(`${mode}: extent preserves HDRI samples with explicit clamp=%s`, async clamp => {
        const samples = [0, 101, 20300, 53000, 62000, 65535].flatMap(value => [value, value, value, 65535]);
        const input = encodeImage({ width: 3, height: 2, data: Uint8Array.from(samples, value => Math.round(value / 257)),
            data16: Uint16Array.from(samples), format: "png", space: "srgb", channels: 3, depth: "ushort", density: 72, hasAlpha: false
        }, { format: "png" }).data;
        const argv = ["/in.png", "-evaluate", "Add", "10000", ...(clamp ? ["-clamp"] : []),
            "-background", "black", "-gravity", "center", "-extent", "5x4", "-evaluate", "Subtract", "10000", "PNG48:/out.png"];
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([5, 4]);
        // ImageMagick 7 Q16-HDRI: only explicit -clamp truncates the intermediate sums.
        const gray = [0, 0, 0, 0, 0, 0, 0, 101, 20300, 0, 0, 53000, clamp ? 55535 : 62000, clamp ? 55535 : 65535, 0, 0, 0, 0, 0, 0];
        expect([...output.data16!]).toEqual(gray.flatMap(value => [value, value, value, 65535]));
    });
}
