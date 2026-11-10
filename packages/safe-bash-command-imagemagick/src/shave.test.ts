import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["map", "retained", "command"] as const) {
    for (const geometry of ["2x1", "1x2", "20x20", "2", "x3", "1x1", "0x0", "0", "+2+1", "+0+0", "-1"]) {
        it(`shaves ${geometry} without exhausting an axis (${mode})`, async () => {
            const pixels = Uint8Array.from({ length: 48 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) + 1);
            const bytes = await sharp(pixels, { raw: { width: 4, height: 3, channels: 4 } }).png().toBuffer();
            const files = new Map([["/input.png", bytes]]), fs = new MemoryFileSystem();
            await fs.writeFile("/input.png", bytes);
            const argv = ["/input.png", "-gravity", "NorthWest", "-shave", geometry, "/output.png"];
            let stderr = "";
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            }) : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" }).then(result => { stderr = result.stderr; return result; });
            expect(result.exitCode).toBe(0);
            const output = decodeImage(mode === "map" ? files.get("/output.png")! : await fs.readFile("/output.png"));
            const valid = geometry === "1x1" || geometry === "0x0" || geometry === "0";
            expect(stderr).toBe(valid ? "" : `magick: geometry does not contain image '/input.png'\n`);
            expect([output.width, output.height]).toEqual(geometry === "1x1" ? [2, 1] : [4, 3]);
            expect(Array.from(output.data)).toEqual(geometry === "1x1" ? [6, 6, 6, 255, 7, 7, 7, 255] : Array.from(pixels));
        });
    }
}
