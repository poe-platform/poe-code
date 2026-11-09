import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: opaque.png -filter Triangle
// -resize (or -thumbnail) '31x23!' PNG32:out.png, decoded with -depth 8 rgba:-.
for (const operation of ["-resize", "-thumbnail"])
for (const mode of ["public", "buffered", "stored", "sync"] as const) {
    it(`${mode}: ${operation} with Triangle matches every native opaque downsample pixel`, async () => {
        const input = readFileSync(new URL("./fixtures/triangle-downsample/opaque.png", import.meta.url));
        const expected = readFileSync(new URL("./fixtures/triangle-downsample/expected.rgba", import.meta.url));
        const fs = new MemoryFileSystem();
        await fs.writeFile("/opaque.png", input);
        const files = new Map<string, Uint8Array>([["opaque.png", input]]);
        const args = ["opaque.png", "-filter", "Triangle", operation, "31x23!", "PNG32:out.png"];
        const argumentValues = createCommandArguments(args);
        const context = {
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
        } as unknown as CommandContext;
        const result = mode === "public" ? await createMagickCommand().execute(context)
            : mode === "sync" ? runMagickCliSync(args, files)
            : await runConvertCli(args, mode === "stored" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "public" || mode === "stored" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([31, 23]);
        const differences = Array.from(output.data).flatMap((value, i) => value === expected[i] ? [] : [{ i, expected: expected[i], actual: value }]);
        expect(differences).toEqual([]);
    });
}
