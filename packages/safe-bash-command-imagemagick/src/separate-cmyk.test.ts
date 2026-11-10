import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runCompareCli, runCompareCliSync, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, RGBA input 20a0e0ff80c040805010f04090204000.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const depth of [8, 16])
for (const opaque of [false, true])
for (const { channel, cmyk } of [
    { channel: "K", cmyk: true }, { channel: "Black", cmyk: true },
    ...(depth === 16 ? [{ channel: "C", cmyk: true }] : []),
    { channel: "A", cmyk: false }, { channel: "A", cmyk: true }
]) {
    it(`${mode}: separates ${channel} from ${depth}-bit input, opaque=${opaque}, cmyk=${cmyk}`, async () => {
        const data = Uint8Array.from([32, 160, 224, 255, 128, 192, 64, 128, 80, 16, 240, 64, 144, 32, 64, 0]);
        const source = encodeImage({ width: 4, height: 1, format: "png", space: "srgb",
            depth: depth === 16 ? "ushort" : "uchar", density: 72, channels: 4, hasAlpha: true, data,
            ...(depth === 16 ? { data16: Uint16Array.from(data, value => value * 257) } : {}) }, { format: "png" }).data;
        const files = new Map([["in.png", source], ["out.png", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const argv = ["in.png", ...(opaque ? ["-alpha", "opaque"] : []),
            ...(cmyk ? ["-colorspace", "CMYK"] : []), "-channel", channel, "-separate", "+channel", "PNG64:out.png"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        if ("stderr" in result) expect(result.stderr).toBe("");
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
        const expected = channel === "A" ? (opaque ? [65535, 65535, 65535, 65535] : [65535, 32896, 16448, 0])
            : channel === "C" ? [0xdb6d, 0x5555, 0xaaaa, 0] : [0x1f1f, 0x3f3f, 0x0f0f, 0x6f6f];
        expect([output.width, output.height]).toEqual([4, 1]);
        expect(Array.from(output.data16!)).toEqual(expected.flatMap(value => [value, value, value, 65535]));
    });
}

for (const mode of ["buffered", "retained", "sync"] as const)
for (const channel of ["K", "Black", "A"])
it(`${mode}: compares a separated CMYK ${channel} plane`, async () => {
    const input = new Uint8Array([...new TextEncoder().encode("P7\nWIDTH 2\nHEIGHT 1\nDEPTH 5\nMAXVAL 255\nTUPLTYPE CMYK_ALPHA\nENDHDR\n"),
        20, 40, 60, 31, 128, 80, 100, 120, 63, 64]);
    const reference = new Uint8Array([...new TextEncoder().encode("P5\n2 1\n255\n"), ...(channel === "A" ? [128, 64] : [31, 63])]);
    const files = new Map([["in.pam", input], ["plane.pgm", reference]]);
    const filesystem = new MemoryFileSystem();
    for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
    const argv = ["-metric", "RMSE", "(", "in.pam", "-channel", channel, "-separate", "+channel", ")", "plane.pgm", "null:"];
    const result = mode === "sync" ? runCompareCliSync(argv, files)
        : await runCompareCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "0 (0)" });
});
