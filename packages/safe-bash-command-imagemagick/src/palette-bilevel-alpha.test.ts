import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = encodeImage({ width: 4, height: 1,
    data: Uint8Array.from(Buffer.from("20a0e0ff80c040805010f04090204000", "hex")),
    format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true,
}, { format: "png", pngCoder: "png32" }).data;

// ImageMagick 7.1.2-35 Q16-HDRI results, decoded as RGBA16 big-endian samples.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ...["PaletteBilevelAlpha", "PaletteBilevelMatte"].flatMap(type => [
            { operations: ["-type", type], rgba: "2020a0a0e0e0ffff8080c0c04040ffff00000000000000000000000000000000" },
            { operations: ["-type", type, "-solarize", "40%"], rgba: "20205f5f1f1fffff7f7f3f3f4040ffff00000000000000000000000000000000" },
            { operations: ["-type", type, "-alpha", "off"], rgba: "2020a0a0e0e0ffff8080c0c04040ffff000000000000ffff000000000000ffff" },
        ]),
        { operations: ["-type", "palettebilevelalpha"], rgba: "2020a0a0e0e0ffff8080c0c04040ffff00000000000000000000000000000000" },
        { operations: ["-alpha", "off", "-type", "PaletteBilevelAlpha"], rgba: "2020a0a0e0e0ffff8080c0c04040ffff50501010f0f0ffff909020204040ffff" },
        { input: encodeImage({ ...decodeImage(input), data16: Uint16Array.of(
            0x2020, 0xa0a0, 0xe0e0, 32767, 0x8080, 0xc0c0, 0x4040, 32768,
            0x5050, 0x1010, 0xf0f0, 0, 0x9090, 0x2020, 0x4040, 65535,
        ) }, { format: "png", pngCoder: "png64" }).data,
        operations: ["-type", "PaletteBilevelAlpha"], rgba: "00000000000000008080c0c04040ffff0000000000000000909020204040ffff" },
        { operations: ["-type", "TrueColorAlpha"], rgba: "2020a0a0e0e0ffff8080c0c04040808050501010f0f040409090202040400000" },
    ].map(test => ({ input, ...test })))(`${mode}: matches native bilevel palette alpha for $operations`, async ({ input, operations, rgba }) => {
        const files = new Map([["in.png", input], ["out.png", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const argv = ["in.png", ...operations, "PNG64:out.png"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
        const expected = Buffer.from(rgba, "hex");
        expect(Array.from(output.data16!)).toEqual(Array.from({ length: expected.length / 2 }, (_, index) => expected.readUInt16BE(index * 2)));
    });
}
