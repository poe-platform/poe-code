import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const channels of [[], ["-channel", "RGB"]]) {
        // ImageMagick 7.1.2-35 Q16-HDRI preserves gray 100 at exactly 25700.
        it.each([
            ["25699", [0, 0, 0, 0, 100, 101, 254, 255]],
            ["25700", [0, 0, 0, 0, 100, 101, 254, 255]],
            ["25701", [0, 0, 0, 0, 0, 101, 254, 255]],
        ] as const)(`${mode}: black threshold %s preserves the strict cutoff with ${channels.length ? "RGB" : "implicit"} channels`, async (threshold, expected) => {
            const input = encodeImage({
                width: 8, height: 1,
                data: Uint8Array.from([0, 1, 50, 99, 100, 101, 254, 255].flatMap(value => [value, value, value, 255])),
                format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false,
            }, { format: "png" }).data;
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const files = new Map([["/in.png", input]]);
            const argv = ["/in.png", ...channels, "-black-threshold", threshold, "PNG32:/out.png"];
            if (mode === "command") {
                const argumentValues = createCommandArguments(argv);
                let stderr = "";
                const context = {
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {},
                    signal: new AbortController().signal, fs: filesystem,
                    stdin: (async function* () {})(), stdout: { async write() {} },
                    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
                    registerCleanup() {},
                } as unknown as CommandContext;
                expect(await createMagickCommand().execute(context)).toMatchObject({ exitCode: 0 });
                expect(stderr).toBe("");
            } else {
                const result = mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            }
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
            expect([...decodeImage(output).data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
        });
    }
}
