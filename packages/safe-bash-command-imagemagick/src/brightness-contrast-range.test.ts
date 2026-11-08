import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI samples for RGB [25, 100, 220].
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["0x100", [0, 0, 255, 255]],
        ["0x101", [255, 255, 0, 255]],
        ["0x-120", [148, 133, 109, 255]],
    ] as const)(`matches native contrast range %s via ${mode}`, async (geometry, expected) => {
        const input = await sharp(Uint8Array.from([25, 100, 220]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
        const files = new Map([["in.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["in.png", "-brightness-contrast", geometry, "out.png"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}
