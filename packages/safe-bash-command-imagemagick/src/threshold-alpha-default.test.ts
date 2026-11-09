import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: omitted alpha is 100 quantum units,
// scaled to full opacity only for percentage thresholds.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const format of ["png", "png32"] as const) {
        it.each([
            ["32768", [0, 64, 127, 128, 192, 255], [0, 255, 255, 255, 255, 255]],
            ["32768,32768,32768", [0, 64, 127, 128, 192, 255], [0, 255, 255, 255, 255, 255]],
            ["50%", [0, 0, 0, 0, 0, 255], [0, 64, 127, 128, 192, 255]],
            ["32768,32768,32768,32768", [0, 0, 0, 128, 192, 255], [0, 64, 127, 255, 255, 255]],
        ] as const)(`uses the native alpha cutoff for %s via ${mode} to ${format}`, async (threshold, black, white) => {
            const input = encodeImage({ width: 6, height: 1, data: Uint8Array.from([0, 64, 127, 128, 192, 255].flatMap(alpha => [96, 160, 32, alpha])), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
            for (const [operator, expected] of [["-black-threshold", black], ["-white-threshold", white]] as const) {
                const files = new Map([["input.png", input]]);
                const filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/input.png", input);
                const args = ["input.png", "-channel", "A", operator, threshold, "+channel", `${format}:out.png`];
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
                expect([...decodeImage(output).data]).toEqual(expected.flatMap(alpha => [96, 160, 32, alpha]));
            }
        });
    }
}
