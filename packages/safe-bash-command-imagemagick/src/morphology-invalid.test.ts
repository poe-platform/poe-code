import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each(["NoSuchMethod", "NoSuchMethod:0", "NotConvolve", "NotCorrelate", "Dilate", "dIlAtE:1"])(`${mode}: validates morphology %s before replacing output`, async method => {
    const pixels = new Uint8Array(9 * 9 * 4);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    pixels.set([255, 255, 255, 255], (4 * 9 + 4) * 4);
    const input = await sharp(pixels, { raw: { width: 9, height: 9, channels: 4 } }).png().toBuffer();
    const destination = await sharp({ create: { width: 9, height: 9, channels: 4, background: "red" } }).png().toBuffer();
    const fs = new MemoryFileSystem(), files = new Map([["/in.png", input], ["/out.png", destination]]);
    await fs.writeFile("/in.png", input);
    await fs.writeFile("/out.png", destination);
    const args = ["/in.png", "-morphology", method, "Diamond:1", "/out.png"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
    if (method.toLowerCase().startsWith("dilate")) {
        expect(result.exitCode).toBe(0);
        for (const [x, y] of [[4, 3], [3, 4], [5, 4], [4, 5]]) pixels.set([255, 255, 255, 255], (y! * 9 + x!) * 4);
        expect(decodeImage(output).data).toEqual(pixels);
    } else {
        expect(result.exitCode).toBe(1);
        expect("stderr" in result ? result.stderr : stderr).toContain("unrecognized function");
        expect(output).toEqual(destination);
    }
});
