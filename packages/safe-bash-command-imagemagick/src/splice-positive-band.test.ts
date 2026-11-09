import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
    it.each(["2x0+4+0", "2x0+5+0", "2x0+6+0", "2x0+7+0", "0x2+0+3", "0x2+0+4", "0x2+0+5", "0x2+0+6", "2x2+5+4"])(`matches native positive splice bands, mode=${mode}, geometry=%s`, async geometry => {
        const pixels = Uint8Array.from({ length: 48 }, (_, i) => i % 4 === 3 ? 100 + Math.floor(i / 4) : Math.floor(i / 4) + 1);
        const bytes = await sharp(pixels, { raw: { width: 4, height: 3, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", bytes);
        const args = ["input.png", "-background", "#ff00ff", "-virtual-pixel", "edge", "-splice", geometry, "out.png"];
        let exitCode: number | undefined, stderr = "";
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} },
                stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } } });
            exitCode = result.exitCode;
        } else {
            const result = await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            exitCode = result.exitCode;
            stderr = result.stderr;
        }
        if (geometry === "0x2+0+6") {
            expect(exitCode).toBe(1);
            expect(stderr).toContain("pixels are not authentic");
            expect(files.has("out.png")).toBe(false);
            expect((await filesystem.readdir("/")).map(entry => entry.name)).toEqual(["input.png"]);
        } else {
            expect(exitCode).toBe(0);
            const output = decodeImage(mode === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
            const [size, x, y] = geometry.split("+");
            const [columns, rows] = size!.split("x").map(Number);
            expect([output.width, output.height]).toEqual([4 + columns!, 3 + rows!]);
            // Native ImageMagick extends the source edge up to the requested band.
            const expected = [];
            for (let row = 0; row < output.height; row++) {
                for (let col = 0; col < output.width; col++) {
                    if ((col >= Number(x) && col < Number(x) + columns!) || (row >= Number(y) && row < Number(y) + rows!)) {
                        expected.push(255, 0, 255, 255);
                    } else {
                        const source = (Math.min(row, 2) * 4 + Math.min(col, 3)) * 4;
                        expected.push(...pixels.subarray(source, source + 4));
                    }
                }
            }
            expect(output.data).toEqual(Uint8Array.from(expected));
        }
    });
}
