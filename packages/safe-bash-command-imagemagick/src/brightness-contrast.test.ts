import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-31: magick -size 1x1 xc:COLOR [-channel CHANNEL]
// -brightness-contrast GEOMETRY -depth 8 rgba:-
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["#80402080", "0x20", [], [128, 48, 8, 128]],
        ["#80402080", "10x0", [], [154, 90, 58, 154]],
        ["#80402080", "10x20", [], [160, 80, 40, 160]],
        ["#80402080", "-10x-20", [], [108, 56, 31, 108]],
        ["#80402080", "-10,-20", [], [108, 56, 31, 108]],
        ["#80402080", "-10/-20", [], [108, 56, 31, 108]],
        ["#80402080", "0x-100", [], [128, 128, 128, 128]],
        ["#80402080", "0x100", [], [255, 0, 0, 255]],
        ["#80402080", "-10x-20", ["-alpha", "off"], [108, 56, 31, 255]],
        ["#80402080", "10x20", ["-channel", "R"], [160, 64, 32, 128]],
        ["#80402080", "10x20", ["-channel", "RGB"], [160, 80, 40, 128]],
        ["#80402080", "10x20", ["-channel", "A"], [128, 64, 32, 160]],
    ] as const)(`matches native brightness-contrast for %s %s %j via ${mode}`, async (color, geometry, channel, expected) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", `xc:${color}`, ...channel, "-brightness-contrast", geometry, "-depth", "8", "rgba:out"];
        const result = mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect([...output]).toEqual(expected);
    });
}

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["bogus", "10x20junk", "10x20", "10,20", "10/20"])(`validates brightness-contrast %s before writing via ${mode}`, async geometry => {
        const input = await sharp(Uint8Array.from([25, 100, 220]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
        const destination = await sharp(Uint8Array.from([255, 0, 0]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
        const files = new Map([["in.png", input], ["out.png", destination]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        await filesystem.writeFile("/out.png", destination);
        const args = ["in.png", "-brightness-contrast", geometry, "out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        if (["10x20", "10,20", "10/20"].includes(geometry)) {
            expect(result.exitCode).toBe(0);
            expect([...decodeImage(output).data]).toEqual([31, 125, 255, 255]);
        } else {
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain("invalid argument for option '-brightness-contrast'");
            expect(output).toEqual(destination);
        }
    });
}
