import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
    it.each(["2", "2x", "2x0"])(`distinguishes omitted chop height, mode=${mode}, geometry=%s`, async (geometry) => {
        const pixels = Uint8Array.from(Array.from({ length: 15 }, (_, i) => [(i + 1) * 10, (i + 1) * 10, (i + 1) * 10]).flat());
        const input = await sharp(pixels, { raw: { width: 5, height: 3, channels: 3 } }).png().toBuffer();
        const files = new Map([["in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["in.png", "-chop", geometry, "out.png"];
        let stderr = "";
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
            expect(result.exitCode).toBe(0);
        } else {
            const result = await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode).toBe(0);
            stderr = result.stderr;
        }
        const output = decodeImage(mode === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
        const removed = geometry === "2" ? 0 : 2;
        expect([output.width, output.height]).toEqual([5 - removed, 3]);
        const expected = [];
        for (let y = 0; y < 3; y++) for (let x = removed; x < 5; x++) {
            const value = (y * 5 + x + 1) * 10;
            expected.push(value, value, value, 255);
        }
        expect(output.data).toEqual(Uint8Array.from(expected));
        if (removed === 0) expect(stderr).toContain("geometry does not contain image");
        else expect(stderr).toBe("");
    });
}
