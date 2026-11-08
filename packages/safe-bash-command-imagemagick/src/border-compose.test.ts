import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

for (const entry of ["command", "sync"] as const) {
    it.each(["Clear", "Dst", "Multiply", "Over", "Src", "SrcIn"])(`${entry}: applies %s inside the border`, async compose => {
        const bytes = await sharp(Uint8Array.from({ length: 240 }, (_, i) => Math.floor(i / 3) + 1), { raw: { width: 10, height: 8, channels: 3 } }).png().toBuffer();
        const args = createCommandArguments(["in.png", "-bordercolor", "red", "-compose", compose, "-border", "1", "out.png"]);
        let output: Uint8Array;
        if (entry === "sync") {
            const files = new Map([["in.png", bytes]]);
            const result = runConvertCliSync(args.args, files);
            expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
            output = files.get("out.png")!;
        } else {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", bytes);
            let stdout = "", stderr = "";
            const command = createMagickCommand();
            const result = await command.execute({
                command: command.name, args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            });
            expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            output = await fs.readFile("/out.png");
        }
        const image = decodeImage(output);
        expect([image.width, image.height]).toEqual([12, 10]);
        for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) {
            const value = (y - 1) * 10 + x;
            const expected = x === 0 || x === 11 || y === 0 || y === 9 || compose === "Dst" ? [255, 0, 0, 255]
                : compose === "Clear" ? [0, 0, 0, 0]
                : compose === "Multiply" ? [value, 0, 0, 255] : [value, value, value, 255];
            expect(Array.from(image.data.subarray((y * 12 + x) * 4, (y * 12 + x + 1) * 4))).toEqual(expected);
        }
    });
}
