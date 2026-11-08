import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCliSync, runIdentifyCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { options: ["+gamma", "2"], pixels: [157, 226, 245, 255], gamma: 0.90909 },
        { options: ["-gamma", "2"], pixels: [226, 247, 252, 255], gamma: 0.90909 },
        { options: ["-channel", "R", "+gamma", "2"], pixels: [157, 240, 250, 255], gamma: 0.90909 },
        { options: ["+gamma", "1"], pixels: [200, 240, 250, 255], gamma: 0.45455 },
    ])(`preserves native gamma pixels and PNG metadata for $options via ${mode}`, async ({ options, pixels, gamma }) => {
        const input = await sharp(Uint8Array.from([200, 240, 250]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", ...options, "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(pixels);
        expect(decodeImage(output)).toMatchObject({ gamma });
        // Reading the written PNG must carry its gamma into a second operation.
        const again = new Map([["/out.png", output]]);
        expect(runConvertCliSync(["/out.png", "+gamma", "0.5", "/again.png"], again).exitCode).toBe(0);
        expect(decodeImage(again.get("/again.png")!)).toMatchObject({ gamma: gamma === 0.45455 ? 0.22727 : 0.45455 });
    });
}

it("accepts +gamma through the command adapter and mogrify", async () => {
    const input = await sharp(Uint8Array.from([200, 240, 250]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const args = createCommandArguments(["/input.png", "+gamma", "2", "/out.png"]);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    const image = decodeImage(await fs.readFile("/out.png"));
    expect([...image.data]).toEqual([157, 226, 245, 255]);
    expect(image.gamma).toBe(0.90909);
    const identified = runIdentifyCliSync(["-format", "%[gamma]", "/out.png"], new Map([["/out.png", await fs.readFile("/out.png")]]));
    expect(identified.stdout).toBe("0.90909");
    const files = new Map([["/input.png", input]]);
    expect(runMogrifyCliSync(["+gamma", "2", "/input.png"], files).exitCode).toBe(0);
    expect(decodeImage(files.get("/input.png")!)).toMatchObject({ data: image.data, gamma: image.gamma });
});
