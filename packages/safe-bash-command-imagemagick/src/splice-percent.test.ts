import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, parseMagickGeometry, runMagickCli } from "./index.js";

it.each(["25x33%", "25x33%+1+2", "25x33+1+2%"])("parses percentage splice geometry %s", geometry => {
    expect(parseMagickGeometry(geometry)).toMatchObject({ width: 25, height: 33, isPercent: true,
        x: geometry.includes("+") ? 1 : 0, y: geometry.includes("+") ? 2 : 0 });
});

for (const mode of ["buffered", "retained", "command"]) {
    it.each(["northwest", "center", "southeast"])(`resolves percentage splice against input dimensions, mode=${mode}, gravity=%s`, async gravity => {
        const retained = mode !== "buffered";
        const pixels = Uint8Array.from({ length: 48 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) + 1);
        const bytes = await sharp(pixels, { raw: { width: 4, height: 3, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", bytes);
        const input = retained ? { filesystem, cwd: "/" } : files;
        for (const [geometry, destination] of [["25x33%", "percent.png"], ["1x1", "literal.png"]] as const) {
            const args = ["input.png", "-gravity", gravity, "-splice", geometry, destination];
            if (mode === "command") {
                const command = createMagickCommand(), argumentValues = createCommandArguments(args);
                const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
                expect(result.exitCode).toBe(0);
            } else {
                expect((await runMagickCli(args, input)).exitCode).toBe(0);
            }
        }
        const output = decodeImage(retained ? await filesystem.readFile("/percent.png") : files.get("percent.png")!);
        const literal = decodeImage(retained ? await filesystem.readFile("/literal.png") : files.get("literal.png")!);
        expect([output.width, output.height]).toEqual([5, 4]);
        expect(output.data).toEqual(literal.data);
        if (gravity === "northwest") {
            const rows = [255,255,255,255,255, 255,1,2,3,4, 255,5,6,7,8, 255,9,10,11,12];
            expect(output.data).toEqual(Uint8Array.from(rows.flatMap(value => [value, value, value, 255])));
        }
    });
}
