import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const inputs = ["xc:#406080", "xc:#102030", "xc:#204060", "xc:#081018"];
// ImageMagick 7.1.2-35 Q16-HDRI, decoded as RGBA16 in real/imaginary order.
const cases = [
    { name: "CMYK Subtract", args: [...inputs, "-colorspace", "CMYK", "-complex", "Subtract"],
        pixels: [[65535, 65535, 65535, 65535], [65535, 65535, 65535, 65535]] },
    { name: "CMYK Add", args: [...inputs, "-colorspace", "CMYK", "-complex", "Add"],
        pixels: [[0x0530, 0, 0, 65535], [0x3d3d, 0, 0, 65535]] },
    { name: "mixed sRGB and CMYK Add", args: [...inputs.slice(0, 2), "(", inputs[2]!, "-colorspace", "CMYK", ")", inputs[3]!, "-complex", "Add"],
        pixels: [[0xeaea, 0xb5b5, 0x8080, 65535], [0x1818, 0x3030, 0x4848, 65535]] },
    { name: "CMYK arithmetic round trip with alpha", args: ["xc:#40608040", "xc:#10203080", "xc:#20406010", "xc:#08101820", "-colorspace", "CMYK", "-complex", "Subtract", "(", "xc:#20406010", "xc:#08101820", "-colorspace", "CMYK", ")", "-complex", "Add"],
        pixels: [[0x4040, 0x6060, 0x8080, 0x4040], [0x1010, 0x2020, 0x3030, 0x8080]] },
    { name: "CMYK round trip", args: [...inputs.slice(0, 2), "-colorspace", "CMYK"],
        pixels: [[0x4040, 0x6060, 0x8080, 65535], [0x1010, 0x2020, 0x3030, 65535]] },
    { name: "sRGB Subtract", args: [...inputs, "-colorspace", "sRGB", "-complex", "Subtract"],
        pixels: [[0x2020, 0x2020, 0x2020, 65535], [0x0808, 0x1010, 0x1818, 65535]] }
];

for (const mode of ["buffered", "sync", "retained", "command"])
it.each(cases)(`${mode}: $name preserves native pixels and output order`, async ({ args, pixels }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    for (let index = 0; index < 2; index++) {
        const path = `/r-${index}.png`, keep = new TextEncoder().encode("KEEP");
        files.set(path, keep);
        await fs.writeFile(path, keep);
    }
    const argv = [...args, "-colorspace", "sRGB", "+adjoin", "PNG64:/r-%d.png"];
    const arguments_ = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += chunk; } }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    for (const [index, expected] of pixels.entries()) {
        const path = `/r-${index}.png`;
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile(path) : files.get(path)!);
        expect([output.width, output.height]).toEqual([1, 1]);
        expect(Array.from(output.data16!)).toEqual(expected);
    }
});
