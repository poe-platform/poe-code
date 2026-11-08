import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["round(u", "u+", "(u", "u)", "u?1", "u[0", "p{0,0", "u.p{0,0", "p[1,0", "u.p[1,0", "p[1]", "p[1,0}", "v.p[1,]", "u.", "round(u,)", "u@", "1e+", "u;round(u", "round(2*u)/2"])(`${mode}: validates the whole FX expression %s before overwriting output`, async expression => {
        const input = encodeImage({ width: 2, height: 1, data: Uint8Array.from([32, 64, 128, 112, 144, 160, 176, 192]), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
        const sentinel = new TextEncoder().encode("keep");
        const files = new Map([["input.png", input], ["out.png", sentinel]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        await filesystem.writeFile("/out.png", sentinel);
        const args = ["input.png", "-channel", "R", "-fx", expression, "out.png"];
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
            signal: new AbortController().signal, registerCleanup() {},
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        if (expression === "round(2*u)/2") {
            expect(result.exitCode).toBe(0);
            expect(Array.from(decodeImage(output).data)).toEqual([0, 64, 128, 112, 128, 160, 176, 192]);
        } else {
            expect(result.exitCode).toBe(1);
            expect(output).toEqual(sentinel);
        }
    });
}
