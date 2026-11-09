import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"]) {
    it.each([
        { gravity: "NorthWest", red: [6, 7, 8, 11, 12, 13] },
        { gravity: "Center", red: [12, 13, 14, 17, 18, 19] },
        { gravity: "SouthEast", red: [6, 7, 8, 11, 12, 13] }
    ])(`preserves extent dimensions and hexadecimal offsets at $gravity via ${mode}`, async ({ gravity, red }) => {
        const pixels = Uint8Array.from(Array.from({ length: 20 }, (_, i) => [i, 0, 0, 255]).flat());
        const input = await sharp(pixels, { raw: { width: 5, height: 4, channels: 4 } }).png().toBuffer();
        for (const geometry of ["3x2+1+1", "3x2+0x1+0x1"]) {
            const files = new Map([["in.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const args = ["in.png", "-background", "white", "-gravity", gravity, "-extent", geometry, "PNG24:out.png"];
            if (mode === "command") {
                const command = createMagickCommand(), argumentValues = createCommandArguments(args);
                const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
                expect(result.exitCode).toBe(0);
            } else {
                const result = mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
                expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            }
            const output = decodeImage(mode === "sync" || mode === "buffered"
                ? files.get("out.png")! : await filesystem.readFile("/out.png"));
            expect([output.width, output.height]).toEqual([3, 2]);
            expect(output.data).toEqual(Uint8Array.from(red.flatMap(value => [value, 0, 0, 255])));
        }
    });
}
