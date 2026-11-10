import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference samples, RGBA16 in big-endian hex.
for (const mode of ["command", "buffered", "sync", "retained"] as const) {
    it.each([
        { name: "one round trip", operations: ["-colorspace", "YCbCr", "-colorspace", "sRGB"], pixels: [{ x: 2, hex: "50621022f1024040" }] },
        { name: "two round trips", operations: Array(2).fill(["-colorspace", "YCbCr", "-colorspace", "sRGB"]).flat(), pixels: [{ x: 2, hex: "50731033f1134040" }] },
        { name: "eight round trips", operations: Array(8).fill(["-colorspace", "YCbCr", "-colorspace", "sRGB"]).flat(), pixels: [{ x: 1, hex: "8039c0793ff98080" }, { x: 2, hex: "50dc109cf17c4040" }, { x: 3, hex: "9082201240320000" }] },
        ...[
            ["R", "819281928192ffff9edb9edb9edbffff3cfa3cfa3cfaffff456645664566ffff"],
            ["G", "b5ceb5ceb5ceffff4a974a974a97ffffe598e598e598ffff7d177d177d17ffff"],
            ["B", "3a863a863a86ffff6a526a526a52ffff8dd78dd78dd7ffffb59bb59bb59bffff"],
        ].map(([channel, expected]) => ({ name: `separated ${channel}`, operations: ["-alpha", "opaque", "-colorspace", "YCbCr", "-channel", channel!, "-separate", "+channel", "-colorspace", "sRGB"], pixels: [{ x: 0, hex: expected! }] })),
        { name: "solarize", operations: ["-alpha", "opaque", "-colorspace", "YCbCr", "-solarize", "40%", "-colorspace", "sRGB"], pixels: [{ x: 0, hex: "1d06c28e1f1400007f88640a02800000299369d30000000000006aae4a8e0000" }] },
    ])(`${mode}: matches native YCbCr $name`, async ({ operations, pixels }) => {
        const { data } = encodeImage({ width: 4, height: 1, data: Buffer.from("20a0e0ff80c040805010f04090204000", "hex"), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" });
        const files = new Map([["/in.png", data], ["/out.png", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/in.png", ...operations, "PNG64:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        if ("stderr" in result) expect(result.stderr).toBe("");
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height, output.depth]).toEqual([4, 1, "ushort"]);
        for (const { x, hex } of pixels) {
            const bytes = Buffer.from(hex, "hex");
            expect([...output.data16!.subarray(x * 4, x * 4 + bytes.length / 2)]).toEqual(Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readUInt16BE(i * 2)));
        }
    });
}
