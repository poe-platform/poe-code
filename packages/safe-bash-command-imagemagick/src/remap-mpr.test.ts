import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(["mpr:fixed", "MPR:fixed", "saved.png", "mpr:missing"])(`${mode}: resolves remap palette %s`, async palette => {
        const input = encodeImage({ width: 6, height: 1,
            data: Uint8Array.from([180, 50, 80, 255, 70, 90, 150, 255, 200, 245, 30, 255, 20, 30, 80, 255, 80, 255, 240, 255, 200, 180, 130, 255]),
            format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false
        }, { format: "png" }).data;
        const colors = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAIAAAB2XpiaAAAAEklEQVR4nGP4z8DA0ADE/4EAABn3BXw+ky5cAAAAAElFTkSuQmCC", "base64"));
        const files = new Map([["input.png", input], ["palette.png", colors]]), fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const argv = ["palette.png", "-write", palette === "saved.png" ? palette : "mpr:fixed", "+delete", "input.png", "+dither", "-remap", palette, "PNG24:out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(palette === "mpr:missing" ? 1 : 0);
        if (palette === "mpr:missing") return;
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        // RGB values verified against native ImageMagick with the same palette and input.
        expect([...decodeImage(output).data]).toEqual([
            255, 0, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
            0, 128, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255
        ]);
    });
}
