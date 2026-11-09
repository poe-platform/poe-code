import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        ["2,0", "0.5,0"],
        ["1,-0.5", "1,0.5"],
        ["0.01,0", "100,0"],
        ["1,0", "1,0"],
    ])(`${mode}: preserves intermediate Polynomial values %s then %s`, async (first, second) => {
        const ramp = [0, 1, 32, 64, 127, 128, 192, 254, 255];
        const pixels = Uint8Array.from(ramp.flatMap(value => [value, value, value, value]));
        const input = await sharp(pixels, { raw: { width: ramp.length, height: 1, channels: 4 } }).png().toBuffer();
        for (const channel of ["RGB", "R", "A", "RGBA"]) {
            const argv = ["/in.png", "-channel", channel, "-function", "Polynomial", first,
                "-function", "Polynomial", second, "-depth", "8", "PNG32:/out.png"];
            const files = new Map([["/in.png", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const args = createCommandArguments(argv);
            const result = mode === "sync" ? runConvertCliSync(argv, files)
                : mode === "buffered" ? await runConvertCli(argv, files)
                : await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args,
                    cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
            const output = mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!;
            expect(output[24]).toBe(8);
            expect([...decodeImage(output).data]).toEqual([...pixels]);
        }
    });
}
