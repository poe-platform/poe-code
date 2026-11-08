import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const evaluate of [false, true])
for (const alpha of [false, true])
for (const [channel, index] of [["R", 0], ["G", 1], ["B", 2], ...(alpha ? [["A", 3] as const] : [])] as const)
for (const mode of ["command", "buffered", "sync"] as const) {
    it(`${mode}: separates exact 16-bit ${channel} samples, alpha=${alpha}, evaluate=${evaluate}`, async () => {
        const data16 = new Uint16Array([0x1234, 0x4567, 0x789a, alpha ? 0x8001 : 65535,
            0xabcd, 0xef01, 0x5678, alpha ? 0xc003 : 65535]);
        const source = encodeImage({ width: 2, height: 1, format: "png", space: "srgb", depth: "ushort",
            density: 72, channels: alpha ? 4 : 3, hasAlpha: alpha, data16,
            data: Uint8Array.from(data16, value => Math.round(value / 257)) }, { format: "png" }).data;
        const arithmetic = evaluate ? ["-evaluate", "Add", "0.4"] : [];
        const argv = ["in.png", ...arithmetic, "-channel", channel, "-separate", "+channel", ...arithmetic, "out.png"];
        const files = new Map([["in.png", source]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", source);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height, output.hasAlpha]).toEqual([2, 1, false]);
        expect(Array.from(output.data16!)).toEqual([0, 4].flatMap(offset => {
            const value = data16[offset + index]! + (evaluate ? 1 : 0);
            return [value, value, value, 65535];
        }));
    });
}
