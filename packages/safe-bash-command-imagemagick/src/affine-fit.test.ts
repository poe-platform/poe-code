import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync, runIdentifyCliSync } from "./index.js";
import fixtures from "./affine-fit-fixtures.json" with { type: "json" };

// Decoded RGBA bytes recorded with ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["public", "sync"] as const) {
    it.each(fixtures.cases)(`matches native Affine $name (${mode})`, async reference => {
        const input = Buffer.from(fixtures.input, "base64");
        const keep = new TextEncoder().encode("KEEP");
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        await fs.writeFile("/out.png", keep);
        const files = new Map([["/input.png", input], ["/out.png", keep]]);
        const args = ["/input.png", ...reference.options, reference.operator, "Affine", reference.points, "/out.png"];
        const argumentValues = createCommandArguments(args);
        const context = {
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
        } as unknown as CommandContext;
        const result = mode === "public" ? await createMagickCommand().execute(context) : runConvertCliSync(args, files);
        expect(result.exitCode).toBe(0);
        const bytes = mode === "public" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        const output = decodeImage(bytes);
        expect([output.width, output.height]).toEqual([reference.width, reference.height]);
        expect(runIdentifyCliSync(["-format", "%g", "/out.png"], new Map([["/out.png", bytes]])).stdout).toBe(reference.page);
        expect(output.data).toEqual(new Uint8Array(Buffer.from(reference.rgba, "base64")));
    });
}
