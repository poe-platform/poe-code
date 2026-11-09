import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, gray strip with alpha, -fill '#dc501e', PNG32 output.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["100:2", "000000ff3200000084172580c3727cffffffffff"],
        ["100:2%", "000000ff3200000084172580c3727cffffffffff"],
        [" 1 0 0 : 2 ", "000000ff3200000084172580c3727cffffffffff"],
        ["25:0.5", "000000ff3200000084172580c3727cffffffffff"],
        ["50,1", "000000ff3200000084172580c3727cffffffffff"],
        ["100,2", "000000ff76000100f2173480ff7287ffffffffff"],
        ["50", "000000ff32080000843e2580c38f7cffffffffff"],
        ["0:2", "000000ff0000000016171680717271ffffffffff"],
        ["100:0", "000000ffff00ff00ff17ff80ff72ffffffffffff"],
        ["0:0", "000000ff0000000016171680717271ffffffffff"],
        ["100:2:0", "000000ff3200000084171680c37271ffffffffff"],
        ["100:2:25", "000000ff3200000084171d80c37277ffffffffff"],
        ["100:+2", "000000ff76200000f2661680ffad71ffffffffff"],
        ["100:-2", "000000ff76000100f2143480ff7087ffffffffff"],
        ["100:-2:25", "000000ff76000000f2141d80ff7077ffffffffff"],
    ])(`${mode}: matches native tint ratio %s`, async (strength, expected) => {
        const pixels = [[0, 255], [48, 0], [128, 128], [192, 255], [255, 255]]
            .flatMap(([gray, alpha]) => [gray!, gray!, gray!, alpha!]);
        const input = await sharp(Uint8Array.from(pixels), { raw: { width: 5, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["/in.png", "-fill", "#dc501e", "-tint", strength, "PNG32:/out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe(expected);
    });
}
