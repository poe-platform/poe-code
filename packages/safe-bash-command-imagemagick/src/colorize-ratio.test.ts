import { expect, it } from "vitest";
import fixtures from "./colorize-ratio-fixtures.json" with { type: "json" };
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick PNG32 output decoded with -depth 8 rgba:-.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["20:2", [54, 90, 155, 30]],
        ["20:4", [47, 90, 158, 30]],
        ["50:2", [75, 90, 148, 30]],
        ["50", [110, 85, 135, 30]],
        ["10,1,10", [54, 90, 155, 30]],
        ["20:2%", [54, 90, 155, 30]],
        [" 2 0 : 2 ", [54, 90, 155, 30]],
        ["20:0.5", [96, 90, 140, 30]],
        ["0:2", [40, 90, 160, 30]],
        ["20:0", [255, 90, 0, 30]],
        ["0:0", [40, 90, 160, 30]],
        ["20:2:0", [54, 90, 160, 30]],
        ["20:2:25", [54, 90, 148, 30]],
        ["20:+2", [68, 88, 159, 30]],
        ["20:-2", [68, 90, 150, 30]],
    ] as const)(`${mode}: matches native colorize ratio %s`, async (strength, expected) => {
        const input = await sharp(new Uint8Array([40, 90, 160, 30]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["/in.png", "-fill", "#b4506e", "-colorize", strength, "PNG32:/out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}

it.each(fixtures.cases)("matches native full-image colorize $strength", async ({ strength, rgba }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", Buffer.from(fixtures.input, "base64"));
    const args = createCommandArguments(["/in.png", "-fill", "#5480cc", "-colorize", strength, "PNG32:/out.png"]);
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} },
    });
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(decodeImage(await fs.readFile("/out.png")).data).toString("hex")).toBe(rgba);
});
