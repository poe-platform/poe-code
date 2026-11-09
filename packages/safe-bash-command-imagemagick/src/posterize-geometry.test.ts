import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, independently decoded as RGBA8.
for (const execution of ["command", "buffered", "sync"] as const) {
    it.each([
        ...["3", "3%", "3x2", "3/2", "3,2"].map(geometry =>
            [geometry, "000000ff800000ff808000ffff8080ffff8080ff"]),
        ...["20", "2 0"].map(geometry =>
            [geometry, "36280dff6b3628ff945136ffc97943ffff9451ff"]),
        ...["0", "0x3"].map(geometry =>
            [geometry, "0000000000000000ff000000ff000000ffff0000"]),
        ...["3junk", "3x2junk", "3e"].map(geometry => [geometry, ""]),
    ])(`${execution}: reads posterize geometry %s`, async (geometry, expected) => {
        const input = await sharp(Uint8Array.from([
            51, 34, 17, 255, 102, 51, 34, 255, 153, 85, 51, 255,
            204, 119, 68, 255, 255, 153, 85, 255,
        ]), { raw: { width: 5, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["in.png", input], ["out.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", input);
        const args = ["in.png", "+dither", "-posterize", geometry!, "PNG32:out.png"];
        const argumentValues = createCommandArguments(args);
        const result = execution === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : execution === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
        const output = execution === "command" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect(result.exitCode).toBe(expected ? 0 : 1);
        if (expected) expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe(expected);
        else expect(output).toEqual(input);
    });
}
