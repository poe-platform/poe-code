import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, RGBA16 samples from the same RGBA8 source.
const cases = [
    { name: "cyan", operations: ["-colorspace", "CMYK", "-channel", "C", "-separate", "+channel"],
        rgba: "db6ddb6ddb6dffff555555555555ffffaaaaaaaaaaaaffff000000000000ffff" },
    { name: "magenta", operations: ["-colorspace", "CMYK", "-channel", "M", "-separate", "+channel"],
        rgba: "492449244924ffff000000000000ffffeeeeeeeeeeeeffffc71cc71cc71cffff" },
    { name: "yellow", operations: ["-colorspace", "CMYK", "-channel", "Y", "-separate", "+channel"],
        rgba: "000000000000ffffaaaaaaaaaaaaffff000000000000ffff8e388e388e38ffff" },
    { name: "black solarize", operations: ["-colorspace", "CMYK", "-channel", "K", "-solarize", "40%", "+channel", "-colorspace", "sRGB"],
        rgba: "2020a0a0e0e0ffff8080c0c04040808050501010f0f040406f6f18c331870000" },
    { name: "all-channel solarize", operations: ["-colorspace", "CMYK", "-solarize", "40%", "-colorspace", "sRGB"],
        rgba: "c0c0a0a0e0e000008080c0c080807f7fa0a0e0e0f0f040406f6f56ac3de80000" },
    { name: "opaque round trip", operations: ["-alpha", "opaque", "-colorspace", "CMYK", "-colorspace", "sRGB"],
        rgba: "2020a0a0e0e0ffff8080c0c04040ffff50501010f0f0ffff909020204040ffff" }
];

for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const depth of [8, 16])
it.each(cases)(`${mode}, ${depth}-bit source: retains fractional CMYK for $name`, async ({ operations, rgba }) => {
    const data = Uint8Array.from([32, 160, 224, 255, 128, 192, 64, 128, 80, 16, 240, 64, 144, 32, 64, 0]);
    const input = encodeImage({ width: 4, height: 1, data, format: "png", space: "srgb", channels: 4,
        depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: true,
        ...(depth === 16 ? { data16: Uint16Array.from(data, value => value * 257) } : {})
    }, { format: "png" }).data;
    const files = new Map([["in.png", input], ["out.png", new TextEncoder().encode("KEEP")]]);
    const fs = new MemoryFileSystem();
    for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
    const argv = ["in.png", ...operations, "PNG64:out.png"];
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
    expect([output.width, output.height]).toEqual([4, 1]);
    expect(output.data16).toBeDefined();
    expect(Array.from(output.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(rgba);
});
