import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const colors = [[248, 29, 162], [11, 75, 254], [92, 240, 126], [140, 38, 93]];
const indices = [1, 2, 3, 0, 3, 1, 0, 2];
const input = new Uint8Array([...new TextEncoder().encode("P6\n4 2\n255\n"), ...indices.flatMap(index => colors[index]!)]);

// Native ImageMagick 7.1.2-35 Q16-HDRI: width and decoded RGBA16 output.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { operations: ["-evaluate", "multiply", "0.001", "-unique-colors"], info: true },
        { operations: ["-evaluate", "add", "100%", "-unique-colors"], info: true },
        { operations: ["-evaluate", "multiply", "1", "-unique-colors"], info: true },
        { operations: ["-evaluate", "multiply", "0.001", "-unique-colors", "-evaluate", "divide", "0.001"], palette: [1, 2, 3, 0] },
        { operations: ["-evaluate", "multiply", "0.001", "-evaluate", "divide", "0.001"], palette: indices },
        { operations: ["-unique-colors"], palette: [3, 2, 1, 0] },
    ])(`preserves distinct working RGB colors (${mode}): $operations`, async ({ operations, info, palette }) => {
        const files = new Map([["/in.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(name, bytes);
        const args = ["/in.ppm", ...operations, ...(info ? ["-format", "%w", "info:/out"] : ["PNG64:/out"])];
        let stderr = "", stdout = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        if (info) expect(new TextDecoder().decode(output)).toBe("4");
        else {
            const image = decodeImage(output);
            expect([image.width, image.height]).toEqual([4, palette!.length / 4]);
            expect(Array.from(image.data16!)).toEqual(palette!.flatMap(index => [...colors[index]!.map(value => value * 257), 65535]));
        }
    });
}
