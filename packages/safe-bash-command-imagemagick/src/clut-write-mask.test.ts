import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI inputs and RGBA8 results.
const source = "iVBORw0KGgoAAAANSUhEUgAAAAUAAAABCAIAAACZnPOkAAAAGElEQVR4nGNgcPjv0HCgVuTVgjtR/2sZADlZB40a4DkbAAAAAElFTkSuQmCC";
const mask = "iVBORw0KGgoAAAANSUhEUgAAAAUAAAABCAIAAACZnPOkAAAAEUlEQVR4nGP4//8/AwMDnAQAR8gI+FqH+a8AAAAASUVORK5CYII=";
const lookups = [
    {
        operation: "-clut",
        png: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAIAAAB2XpiaAAAAFUlEQVR4nGNgENGJ+mB0T+jX/xM2ABzoBaqNPZlHAAAAAElFTkSuQmCC",
        masked: "0040ff 4480c9 7d14ea ce7d3e ff7d00",
        unmasked: "00ba3c 4480c9 98486b ce7d3e ff882c",
    },
    {
        operation: "-hald-clut",
        png: "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAXElEQVR4nB2NsQEAIAzC+iRP8iQmdlApAe9217ucs1xzydfrtZfqb9ddYP/JEkhsSeOgsqZ1QcuWYtL4ozS5pmsyUiS6OtHtEDTw7fzP2zBvi+0iASQWKzcVLvADM0lfoV1S878AAAAASUVORK5CYII=",
        masked: "0040ff c0bf80 7d14ea 5a5fdc ff7d00",
        unmasked: "ffff40 c0bf80 ea8214 5a5fdc 00007d",
    },
];

for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const lookup of lookups)
for (const removeBefore of [false, true])
it(`${mode}: ${lookup.operation} respects the source mask, removed before=${removeBefore}`, async () => {
    const files = new Map([
        ["/in.png", Buffer.from(source, "base64")],
        ["/mask.png", Buffer.from(mask, "base64")],
        ["/lut.png", Buffer.from(lookup.png, "base64")],
    ]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const args = ["/in.png", "-write-mask", "/mask.png", ...(removeBefore ? ["+write-mask"] : []), "/lut.png", lookup.operation, "+write-mask", "PNG24:/out.png"];
    if (mode === "command") {
        const values = createCommandArguments(args);
        let stderr = "";
        expect(await createMagickCommand().execute({
            command: "magick", args: values.args, argumentValues: values, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        })).toMatchObject({ exitCode: 0 });
        expect(stderr).toBe("");
    } else {
        expect(mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    }
    const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect(output.data).toEqual(Uint8Array.from((removeBefore ? lookup.unmasked : lookup.masked).split(" ").flatMap(hex => [...Buffer.from(hex, "hex"), 255])));
});

for (const mode of ["buffered", "retained", "sync"] as const)
for (const operation of ["-clut", "-hald-clut"])
it(`${mode}: ${operation} preserves protected 16-bit RGBA samples and its mask for later edits`, async () => {
    const samples = Uint16Array.of(12345, 23456, 34567, 45678, 11111, 22222, 33333, 44444);
    const input = encodeImage({
        format: "png", width: 2, height: 1, space: "srgb", channels: 4, hasAlpha: true, depth: "ushort", density: 72,
        data: Uint8Array.from(samples, value => Math.round(value / 257)), data16: samples,
    }, { format: "png" }).data;
    const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const args = ["/in.png", "-write-mask", "xc:white", "xc:black", operation, "-negate", "+write-mask", "/out.png"];
    expect(mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect(output.data16).toEqual(samples);
});
