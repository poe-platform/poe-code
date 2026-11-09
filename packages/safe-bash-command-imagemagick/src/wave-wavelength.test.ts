import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createImagemagickCommand, runConvertCliSync } from "./index.js";
import fixtures from "./wave-wavelength-fixtures.json" with { type: "json" };

// Decoded 8-bit RGBA samples from native ImageMagick, using the same RGB PNG.
it.each(fixtures.cases)("preserves wave wavelength $geometry", async ({ geometry, rgba }) => {
    const input = Buffer.from(fixtures.input, "base64");
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const argv = ["/input.png", "-wave", geometry, "/output.png"];
    const args = createCommandArguments(argv);
    expect((await createImagemagickCommand().execute({
        command: "magick", args: args.args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write() {} },
    })).exitCode).toBe(0);
    const files = new Map<string, Uint8Array>([["/input.png", input]]);
    expect(runConvertCliSync(argv, files).exitCode).toBe(0);
    for (const bytes of [await fs.readFile("/output.png"), files.get("/output.png")!]) {
        const output = decodeImage(bytes);
        expect([output.width, output.height]).toEqual([7, 9]);
        expect([...output.data]).toEqual(rgba);
    }
});
