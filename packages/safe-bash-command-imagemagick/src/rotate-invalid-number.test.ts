import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(["0x5a", "0b1011010", "0o132", "", "bogus", "90"])(`preserves output for invalid numeric rotation %j (${mode})`, async angle => {
        const pixels = Uint8Array.from([10, 40, 70, 100, 130, 160, 190, 220].flatMap(v => [v, v, v]));
        const input = await sharp(pixels, { raw: { width: 4, height: 2, channels: 3 } }).png().toBuffer();
        const sentinel = await sharp(Uint8Array.of(23, 23, 23), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
        const files = new Map([["input.png", input], ["out.png", sentinel]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        await filesystem.writeFile("/out.png", sentinel);
        const args = ["input.png", "-rotate", angle, "out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const valid = angle === "90";
        expect(result.exitCode).toBe(valid ? 0 : 1);
        if (!valid) expect("stderr" in result ? result.stderr : stderr).toContain("invalid rotation angle");
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        if (!valid) expect(bytes).toEqual(sentinel);
        const output = decodeImage(bytes);
        expect([output.width, output.height]).toEqual(valid ? [2, 4] : [1, 1]);
        expect([...output.data]).toEqual((valid ? [130, 10, 160, 40, 190, 70, 220, 100] : [23]).flatMap(v => [v, v, v, 255]));
    });
}
