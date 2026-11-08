import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "command"] as const) {
    it.each([
        { operator: "-level", endpoints: "0%,100%", expected: [0x4321, 0x8765, 0xabcd] },
        { operator: "+level", endpoints: "0%,100%", expected: [0x4321, 0x8765, 0xabcd] },
        { operator: "-level", endpoints: "20%,80%", expected: [0x1a8d, 0x8c53, 0xc901] },
        { operator: "+level", endpoints: "20%,80%", expected: [0x5b7a, 0x8470, 0x9a48] },
    ])(`preserves native Q16 samples for $operator $endpoints via ${mode}`, async ({ operator, endpoints, expected }) => {
        const samples = [0x4321, 0x8765, 0xabcd, 65535];
        const input = encodeImage({ width: 1, height: 1, format: "png", space: "srgb", channels: 3,
            density: 72, hasAlpha: false, depth: "ushort", data16: Uint16Array.from(samples),
            data: Uint8Array.from(samples, value => Math.round(value / 257)) }, { format: "png" }).data;
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["/in.png", operator, endpoints, "/out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args,
            argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
            : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect(output.depth).toBe("ushort");
        expect(Array.from(output.data16 ?? [])).toEqual([...expected, 65535]);
    });
}
