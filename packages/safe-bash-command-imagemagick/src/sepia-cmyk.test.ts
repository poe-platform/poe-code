import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import fixture from "./sepia-cmyk-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI: PNG32 output decoded with -depth 8 rgba:-.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(fixture.cases)(`tones working CMYK channels and alpha (${mode}): $args`, async ({ args, rgba }) => {
    const input = Buffer.from(fixture.input, "base64");
    const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const argv = ["in.png", ...args, "PNG32:out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("out.png")! : await fs.readFile("/out.png"));
    expect([output.width, output.height]).toEqual([11, 9]);
    expect(Buffer.from(output.data).toString("hex")).toBe(rgba);
});

it("uses the global CMYK histogram across retained storage chunks", async () => {
    const image = decodeImage(Buffer.from(fixture.input, "base64"));
    const data = Uint8Array.from({ length: image.data.length * 80 }, (_, i) => image.data[i % image.data.length]!);
    const input = encodeImage({ ...image, height: image.height * 80, data }, { format: "png" }).data;
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const reference = fixture.cases[0]!;
    const result = await runMagickCli(["in.png", ...reference.args, "PNG32:out.png"], { filesystem: fs, cwd: "/" });
    expect(result.exitCode, result.stderr).toBe(0);
    const output = decodeImage(await fs.readFile("/out.png"));
    expect(Buffer.from(output.data).toString("hex")).toBe(reference.rgba.repeat(80));
});
