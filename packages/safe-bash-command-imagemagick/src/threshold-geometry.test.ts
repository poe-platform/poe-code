import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick Q16: only the first geometry field sets the cutoff and units.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["50%x20", [255, 0, 0, 0]],
        ["50x20%", [255, 255, 255, 255]],
        ["50%", [255, 0, 0, 0]],
        ["50", [255, 255, 255, 255]],
    ] as const)(`${mode} thresholds geometry %s using the first field`, async (threshold, expected) => {
        const input = encodeImage({ width: 4, height: 1, data: Uint8Array.from([128, 128, 128, 128, 20, 70, 220, 40, 199, 48, 21, 230, 37, 37, 37, 96]), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
        const files = new Map([["input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const argv = ["input.png", "-threshold", threshold, "PNG32:out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command"
            ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
                registerCleanup() {}, fs: filesystem,
            } as unknown as CommandContext)
            : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected.flatMap(value => [value, value, value, value]));
    });
}
