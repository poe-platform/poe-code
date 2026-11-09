import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI output for two pixels on opposite sides of 50% intensity.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        [[], [0, 0, 0, 0, 203, 160, 37, 0], [37, 120, 203, 30, 255, 255, 255, 200]],
        [["-channel", "Default"], [0, 0, 0, 0, 203, 160, 37, 0], [37, 120, 203, 30, 255, 255, 255, 200]],
        [["-channel", "dEfAuLt"], [0, 0, 0, 0, 203, 160, 37, 0], [37, 120, 203, 30, 255, 255, 255, 200]],
        [["-channel", "R", "-channel", "Default"], [0, 0, 0, 0, 203, 160, 37, 0], [37, 120, 203, 30, 255, 255, 255, 200]],
        [["-channel", "R", "+channel"], [0, 0, 0, 0, 203, 160, 37, 0], [37, 120, 203, 30, 255, 255, 255, 200]],
        [["-channel", "R"], [0, 120, 203, 30, 203, 160, 37, 200], [37, 120, 203, 30, 255, 160, 37, 200]],
        [["-channel", "G"], [37, 0, 203, 30, 203, 160, 37, 200], [37, 120, 203, 30, 203, 255, 37, 200]],
        [["-channel", "B"], [37, 120, 203, 30, 203, 160, 0, 200], [37, 120, 255, 30, 203, 160, 37, 200]],
        [["-channel", "A"], [37, 120, 203, 0, 203, 160, 37, 0], [37, 120, 203, 30, 203, 160, 37, 200]],
        [["-channel", "RGB"], [0, 0, 203, 30, 203, 160, 0, 200], [37, 120, 255, 30, 255, 255, 37, 200]],
        [["-channel", "RGBA"], [0, 0, 203, 0, 203, 160, 0, 0], [37, 120, 255, 30, 255, 255, 37, 200]],
    ] as const)(`matches native black/white thresholds for %j via ${mode}`, async (channels, black, white) => {
        const input = encodeImage({ width: 2, height: 1, data: Uint8Array.from([37, 120, 203, 30, 203, 160, 37, 200]), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
        for (const [operator, expected] of [["-black-threshold", black], ["-white-threshold", white]] as const) {
            const files = new Map([["input.png", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const args = ["input.png", ...channels, operator, "50%", "+channel", "PNG32:out.png"];
            if (mode === "command") {
                const argumentValues = createCommandArguments(args);
                let stderr = "";
                const context = {
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write() {} },
                    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
                    registerCleanup() {}, fs: filesystem,
                } as unknown as CommandContext;
                expect(await createMagickCommand().execute(context)).toMatchObject({ exitCode: 0 });
                expect(stderr).toBe("");
            } else {
                const result = mode === "sync" ? runConvertCliSync(args, files)
                    : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result).toMatchObject({ exitCode: 0 });
            }
            const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data]).toEqual(expected);
        }
    });
}
