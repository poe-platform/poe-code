import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick Q16 includes alpha differences equal to the fuzz threshold.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const operation of ["-opaque", "+opaque", "-transparent", "+transparent"])
it.each([0, 1, 2, 3, 4, 5, 6, 7])(`${mode}: ${operation} includes the Q16 alpha fuzz boundary %i`, async fuzz => {
    const data16 = Uint16Array.from([
        ...Array.from({ length: 8 }, (_, index) => [10000, 20000, 30000, 65535 - index]).flat(),
        11000, 20000, 30000, 65535,
    ]);
    const source = encodeImage({ width: 9, height: 1, format: "png", density: 72, channels: 4,
        hasAlpha: true, space: "srgb", depth: "ushort", data16,
        data: Uint8Array.from(data16, value => Math.round(value / 257)) }, { format: "png" }).data;
    const files = new Map([["/input.png", source]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", source);
    const args = ["/input.png", "-fuzz", String(fuzz),
        ...(operation.endsWith("opaque") ? ["-fill", "white"] : []),
        operation, "#27104e207530ffff", "PNG64:/output.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
        : mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} },
        })
        : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = mode === "retained" || mode === "command"
        ? await fs.readFile("/output.png") : files.get("/output.png")!;
    const expected = Array.from(data16);
    for (let index = 0; index < 9; index++) {
        const matched = index < 8 && index <= fuzz;
        if (operation.startsWith("+") ? !matched : matched) {
            if (operation.endsWith("transparent")) expected[index * 4 + 3] = 0;
            else expected.fill(65535, index * 4, index * 4 + 4);
        }
    }
    expect(output[24]).toBe(16);
    expect(Array.from(decodeImage(output).data16!)).toEqual(expected);
});
