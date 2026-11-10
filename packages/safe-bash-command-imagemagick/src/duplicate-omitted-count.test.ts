import { createCommandArguments } from "safe-bash-contracts";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMontageCli } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "montage", "command"] as const) {
    it.each([",1", "x2", "0,1", "1,1"])(`preserves pixels with duplicate count %s: ${mode}`, async count => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const inputs = ["-size", "1x1", "xc:red", "xc:lime", "xc:blue", "xc:white"];
        if (mode === "montage") {
            inputs.splice(0);
            for (const color of ["red", "lime", "blue", "white"]) {
                expect(runConvertCliSync(["-size", "1x1", `xc:${color}`, `${color}.png`], files).exitCode).toBe(0);
                inputs.push(`${color}.png`);
            }
        }
        const args = [...inputs, "-duplicate", count,
            ...(mode === "montage" ? ["-tile", "x1", "-geometry", "1x1+0+0", "-background", "black"] : ["+append"]), "PNG24:out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, fs: filesystem, cwd: "/", env: {},
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        })
            : mode === "montage" ? await runMontageCli(args, files)
            : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const image = decodeImage((mode === "retained" || mode === "command") ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255], white = [255, 255, 255, 255];
        expect([image.width, image.height]).toEqual([count === "1,1" ? 5 : 4, 1]);
        expect([...image.data]).toEqual([red, green, blue, white, ...(count === "1,1" ? [green] : [])].flat());
    });
}
