import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(["bogus", "2junk", "2,1junk,0.5"])("rejects malformed gamma %s without overwriting output via " + mode, async gamma => {
        const input = await sharp(Uint8Array.from([200, 240, 250]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
        const destination = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } }).png().toBuffer();
        const files = new Map([["/input.png", input], ["/out.png", destination]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/input.png", "-gamma", gamma, "/out.png"];
        const result = mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("gamma");
        expect(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(destination);
    });

    it.each(["2", "2,1,0.5"])("matches native gamma %s RGBA pixels via " + mode, async gamma => {
        const input = await sharp(Uint8Array.from([
            12, 34, 56, 255, 78, 90, 123, 128,
            144, 160, 180, 64, 210, 220, 230, 255
        ]), { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        if (mode === "retained") await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-gamma", gamma, "/out.png"];
        const result = mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        // Native ImageMagick uses the leading gamma value for every selected channel.
        expect([...decodeImage(output).data]).toEqual([
            55, 93, 119, 255, 141, 151, 177, 181,
            192, 202, 214, 128, 231, 237, 242, 255
        ]);
    });
}

// ImageMagick 7.1.2-31: magick -size 1x1 xc:'#808080' -gamma VALUE -depth 8 rgba:-
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([[1.5, 161], [0.5, 64], [1, 128]])("matches native gamma %s midtones via " + mode, async (gamma, value) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:#808080", "-gamma", String(gamma), "out.png"];
        const result = mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual([value, value, value, 255]);
    });
}

// Native ImageMagick 7.1.2-31: magick -size 1x1 xc:'#80402080' ... -depth 8 rgba:-
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { options: ["-channel", "R", "-gamma", "1.5", "+channel"], expected: [161, 64, 32, 128] },
        { options: ["-channel", "G", "-gamma", "1.5", "+channel"], expected: [128, 101, 32, 128] },
        { options: ["-channel", "B", "-gamma", "1.5", "+channel"], expected: [128, 64, 64, 128] },
        { options: ["-channel", "A", "-gamma", "1.5", "+channel"], expected: [128, 64, 32, 161] },
        { options: ["-channel", "RGB", "-gamma", "1.5"], expected: [161, 101, 64, 128] },
        { options: ["-channel", "RGBA", "-gamma", "1.5", "+channel"], expected: [161, 101, 64, 161] },
        { options: ["-gamma", "1.5"], expected: [161, 101, 64, 161] },
        { options: ["-channel", "Default", "-gamma", "1.5", "+channel"], expected: [161, 101, 64, 161] },
        { options: ["-channel", "Default", "+gamma", "2", "+channel"], expected: [64, 16, 4, 64] },
        { options: ["-channel", "R", "+channel", "-gamma", "1.5"], expected: [161, 101, 64, 161] },
        { options: ["-channel", "R", "-gamma", "1.5", "-channel", "A", "-gamma", "0.5", "+channel"], expected: [161, 64, 32, 64] }
    ])("matches native channel-scoped gamma $options via " + mode, async ({ options, expected }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:#80402080", ...options, "out.png"];
        const result = mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}

// Native ImageMagick: 8-bit RGBA input, -channel RGBA/R -gamma VALUE -depth 8 rgba:-.
for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const channel of ["RGBA", "R"]) {
        it.each([
            { gamma: "0.05", expected: [2, 76, 172, 0], black: 0 },
            { gamma: "0.1", expected: [22, 139, 209, 0], black: 0 },
            { gamma: "0", expected: [0, 0, 0, 0], black: 0 },
            { gamma: "-0", expected: [0, 0, 0, 0], black: 0 },
            { gamma: "-1", expected: [255, 255, 255, 255], black: 255 }
        ])("matches native gamma $gamma including endpoints via " + mode + " channel " + channel, async ({ gamma, expected, black }) => {
            const input = await sharp(Uint8Array.from([
                200, 240, 250, 128, 0, 0, 0, 0, 255, 255, 255, 255
            ]), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
            const files = new Map([["/input.png", input]]);
            const filesystem = new MemoryFileSystem();
            if (mode === "retained") await filesystem.writeFile("/input.png", input);
            const args = ["/input.png", "-channel", channel, "-gamma", gamma, "/out.png"];
            const result = mode === "sync"
                ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0 });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
            expect([...decodeImage(output).data]).toEqual(channel === "R"
                ? [expected[0], 240, 250, 128, black, 0, 0, 0, 255, 255, 255, 255]
                : [...expected, black, black, black, black, 255, 255, 255, 255]);
        });
    }
}

// Native ImageMagick 7.1.2-35 Q16-HDRI, PNG32 output decoded to 8-bit RGBA.
it("includes alpha in explicit Default gamma through the public command", async () => {
    const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDA6MTE6NTgrMDA6MDDquOzeAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAwOjExOjU4KzAwOjAwm+VUYgAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMDoxMTo1OCswMDowMMzwdb0AAAETSURBVBjTAQgB9/4AJXjLHo7hNIf3Sp3wYLMGWckcb8Iyhdgrm+5BlARXqv0AbcATZtYpfM8/kuU4qPtOoRFktwp6zSBz4zaJ3Eyf8kUAtQhbrh5xxBeH2i2A8EOW6Vms/1LCFWi7K37RJJTnOo0A/VCj9ma5DF/PInXIOIveMaH0R5oKXbADc8YZbNwvgtUARZjrPq4BVKcXar0QgNMmeek8j+JSpfhLuw5htCR3yh0AjeAzhvZJnO9fsgVYyBtuwTGE1yqa7UCTA1ap/Gy/EmUA1Sh7zj6R5Den+k2gEGO2CXnMH3LiNYjbS57xRLQHWq0AHXDDFobZLH/vQpXoWKv+UcEUZ7oqfdAjk+Y5jPxPovUcJoEBTbp3hAAAAABJRU5ErkJggg==", "base64");
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const args = createCommandArguments(["/input.png", "-channel", "Default", "-gamma", "2", "+channel", "PNG32:/out.png"]);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    const output = decodeImage(await fs.readFile("/out.png"));
    expect([...output.data.slice(0, 4)]).toEqual([97, 175, 228, 87]);
    const files = new Map([["/input.png", input]]);
    expect(runConvertCliSync(["/input.png", "-gamma", "2", "PNG32:/implicit.png"], files).exitCode).toBe(0);
    expect(output.data).toEqual(decodeImage(files.get("/implicit.png")!).data);
});
