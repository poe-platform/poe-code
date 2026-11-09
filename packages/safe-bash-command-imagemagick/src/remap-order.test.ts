import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([true, false])(`${mode}: requires an image before remap (early=%s)`, async early => {
        const input = await sharp(Uint8Array.of(200, 200, 200), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
        const palette = await sharp(Uint8Array.of(0, 0, 0, 255, 255, 255), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["input.png", input], ["palette.png", palette], ["early.png", keep]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const argv = ["+dither", ...(early ? ["-remap", "palette.png", "input.png"] : ["input.png", "-remap", "palette.png"]), "PNG24:early.png"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(early ? 1 : 0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/early.png") : files.get("early.png")!;
        if (early) {
            expect("stderr" in result ? result.stderr : stderr).toContain("no images found for operation '-remap'");
            expect(output).toEqual(keep);
        } else {
            expect(Array.from(decodeImage(output).data)).toEqual([255, 255, 255, 255]);
        }
    });
}
