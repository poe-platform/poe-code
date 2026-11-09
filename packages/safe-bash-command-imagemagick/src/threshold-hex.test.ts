import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    // Native ImageMagick 7.1.2-35 Q16-HDRI: only the first pixel exceeds
    // 32895.999; none exceeds 32896 (0x8080). Default threshold includes alpha.
    it.each([
        ["0x8080", 0],
        ["0X8080", 0],
        ["+0x8080", 0],
        ["32896", 0],
        ["32895.999", 255],
        ["0x807f", 255],
    ] as const)(`${mode}: interprets Q16 threshold %s with a strict cutoff`, async (threshold, first) => {
        const input = encodeImage({ width: 4, height: 1, data: new Uint8Array([128, 128, 128, 128, 20, 70, 220, 40, 199, 48, 21, 230, 37, 37, 37, 96]), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
        const files = new Map([["/in.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const argv = ["/in.png", "-threshold", threshold, "PNG32:/out.png"];
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
        expect([...decodeImage(output).data]).toEqual([first, first, first, first, ...Array<number>(12).fill(0)]);
    });
}

it.each(["0x", "0x8080junk", "0xInfinity", "0b10", "0o10", ""])("rejects invalid threshold %j without replacing output", threshold => {
    const destination = new TextEncoder().encode("keep");
    const files = new Map([["out.png", destination]]);
    expect(runConvertCliSync(["xc:red", "-threshold", threshold, "out.png"], files).exitCode).toBe(1);
    expect(files.get("out.png")).toEqual(destination);
});
