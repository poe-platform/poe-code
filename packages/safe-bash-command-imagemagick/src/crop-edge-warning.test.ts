import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["1x1+4+1", true, 4, 3, 0, 0],
        ["1x1+3+3", true, 4, 3, 0, 0],
        ["1x1+3+2", false, 1, 1, 3, 2],
        ["1x1+5+1", true, 1, 1, -1, -1],
    ] as const)(`preserves crop %s pixels, page and warnings (${mode})`, async (geometry, warns, width, height, x, y) => {
        const pixels = Uint8Array.from({ length: 48 }, (_, i) => i % 4 === 3 ? 255 : i * 5);
        const input = await sharp(pixels, { raw: { width: 4, height: 3, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-crop", geometry, "PNG64:/output.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe(warns ? `magick: geometry does not contain image '${geometry}'\n` : "");
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(output.virtualCanvas ?? { width: 4, height: 3, x: 0, y: 0 }).toEqual({ width: 4, height: 3, x, y });
        expect(output.data).toEqual(width === 4 ? pixels : x === -1 ? new Uint8Array([255, 255, 255, 0]) : pixels.slice(-4));
    });
}
