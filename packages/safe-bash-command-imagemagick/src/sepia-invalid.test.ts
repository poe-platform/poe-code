import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each(["bogus", "80foo", "0xcccc", "", "80foo%", "NaN", "Infinity", "0b0", "0o0"])(
        `${mode}: rejects invalid sepia threshold %j without replacing output`, async threshold => {
            const input = await sharp(Uint8Array.from([
                220, 40, 70, 255, 40, 200, 100, 128, 25, 100, 220, 0, 66, 85, 190, 255,
            ]), { raw: { width: 4, height: 1, channels: 4 } }).png().toBuffer();
            const files = new Map([["/in.png", input], ["/out.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            await fs.writeFile("/out.png", input);
            const argv = ["/in.png", "-sepia-tone", threshold, "PNG32:/out.png"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect.soft(result.exitCode).toBe(1);
            expect.soft("stderr" in result ? result.stderr : stderr).toContain("invalid argument '-sepia-tone'");
            expect(mode === "buffered" || mode === "sync" ? files.get("/out.png") : await fs.readFile("/out.png")).toEqual(input);
        }
    );

    it.each([
        ["80%", [57, 29, 24, 255]],
        ["52428", [57, 29, 24, 255]],
        ["5.24288e4", [57, 29, 24, 255]],
        ["80%%", [57, 29, 24, 255]],
        ["0", [255, 255, 18, 255]],
        ["x10", [255, 255, 18, 255]],
        ["x32768", [255, 255, 18, 255]],
        ["/2", [255, 255, 18, 255]],
        ["!", [255, 255, 18, 255]],
        ["0x0", [255, 255, 18, 255]],
        ["80x20", [255, 255, 18, 255]],
    ] as const)(`${mode}: accepts valid sepia threshold %s`, async (threshold, expected) => {
        const input = await sharp({ create: { width: 1, height: 1, channels: 3, background: "blue" } }).png().toBuffer();
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["/in.png", "-sepia-tone", threshold, "PNG32:/out.png"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const output = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png");
        // Native ImageMagick 7.1.2-35 Q16-HDRI reference.
        expect(Array.from(decodeImage(output).data)).toEqual(expected);
    });
}
