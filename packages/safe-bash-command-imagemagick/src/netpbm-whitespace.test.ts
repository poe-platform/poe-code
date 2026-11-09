import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

it.each([0x20, 0x0b, 0x0c].flatMap(separator =>
    [0x80, 0x0b, 0x0c, 0x20, 0x23].map(pixel => ({ separator, pixel }))
))("decodes separator $separator without consuming raster byte $pixel", async ({ separator, pixel }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.pgm", Buffer.concat([
        Buffer.from(`P5\n1${String.fromCharCode(separator)}1\n255\n`), Buffer.from([pixel])
    ]));
    await fs.writeFile("/out.miff", Buffer.from("keep"));
    for (const tokens of [["in.pgm", "out.miff"], ["out.miff", "-depth", "8", "out.ppm"]]) {
        const args = createCommandArguments(tokens);
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect(stderr).toBe("");
        expect(result.exitCode).toBe(0);
    }
    expect(Buffer.from(await fs.readFile("/out.ppm"))).toEqual(Buffer.concat([
        Buffer.from("P6\n1 1\n255\n"), Buffer.from([pixel, pixel, pixel])
    ]));
});
