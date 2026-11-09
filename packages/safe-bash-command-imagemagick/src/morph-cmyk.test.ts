import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: 4x4 CMYK JPEG and sRGB PNG.
const cmyk = Buffer.from("ffd8ffee000e41646f626500640000000002ffdb00430001010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101ffdb00430101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101ffc00014080004000404011100021101031101041100ffc40014000100000000000000000000000000000009ffc40014100100000000000000000000000000000000ffc400150101010000000000000000000000000000090affc40014110100000000000000000000000000000000ffda000e040100021103110400003f002fd46001cf43ffd9", "hex");
const rgb = Buffer.from("89504e470d0a1a0a0000000d494844520000000400000004080200000026930929000000206348524d00007a26000080840000fa00000080e8000075300000ea6000003a98000017709cba513c00000006624b474400ff00ff00ffa0bda7930000002574455874646174653a63726561746500323032362d31312d30375431303a31323a34392b30303a303078b7dabb0000002574455874646174653a6d6f6469667900323032362d31312d30375431303a31323a34392b30303a303009ea62070000002874455874646174653a74696d657374616d7000323032362d31312d30375431303a31323a34392b30303a30305eff43d8000000144944415408d763144838c000034c0c48003707003bb4013835053b6b0000000049454e44ae426082", "hex");

for (const mode of ["map", "sync", "filesystem", "command"])
for (const reverse of [false, true])
for (const convertFirst of [false, true])
it(`morphs mixed CMYK/sRGB channels (${mode}, reverse=${reverse}, convertFirst=${convertFirst})`, async () => {
    const files = new Map<string, Uint8Array>([["/cmyk.jpg", cmyk], ["/b.png", rgb]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = [...(reverse ? ["/b.png", "/cmyk.jpg"] : ["/cmyk.jpg", "/b.png"]),
        ...(convertFirst ? ["-colorspace", "sRGB"] : []), "-morph", "1", "-delete", "0,2", "-colorspace", "sRGB", "PNG32:/out.png"];
    let stderr = "";
    const argumentValues = createCommandArguments(args);
    const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: argumentValues.args, argumentValues,
        fs, cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } })
        : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    expect(stderr).toBe("");
    const image = decodeImage(mode === "map" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    const pixel = convertFirst ? [103, 102, 112, 255] : reverse ? [8, 103, 202, 255] : [183, 113, 39, 255];
    expect(Array.from(image.data)).toEqual(Array.from({ length: 16 }, () => pixel).flat());
});

for (const retained of [false, true])
for (const resized of [false, true])
for (const scenario of ["mixed", "reverse", "both-cmyk", "red-only"])
it(`keeps ink and alpha planes independent (retained=${retained}, resized=${resized}, ${scenario})`, async () => {
    const size = resized ? 3 : 1, both = scenario === "both-cmyk";
    const first = Buffer.concat([Buffer.from("P7\nWIDTH 1\nHEIGHT 1\nDEPTH 5\nMAXVAL 255\nTUPLTYPE CMYK_ALPHA\nENDHDR\n"), Buffer.from([50, 100, 150, 80, 64])]);
    const second = Buffer.concat([Buffer.from(`P7\nWIDTH ${size}\nHEIGHT ${size}\nDEPTH ${both ? 5 : 4}\nMAXVAL 255\nTUPLTYPE ${both ? "CMYK_ALPHA" : "RGB_ALPHA"}\nENDHDR\n`),
        Buffer.from(Array.from({ length: size * size }, () => both ? [20, 60, 180, 40, 192] : [20, 60, 180, 192]).flat())]);
    const files = new Map([["/a.pam", first], ["/b.pam", second]]), fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = [...(scenario === "reverse" ? ["/b.pam", "/a.pam"] : ["/a.pam", "/b.pam"]),
        ...(scenario === "red-only" ? ["-channel", "R"] : []), "-morph", "1", "-delete", "0,2", "/out.pam"];
    expect(await runConvertCli(args, retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0, stderr: "" });
    const output = decodeImage(retained ? await fs.readFile("/out.pam") : files.get("/out.pam")!);
    const pixels = resized ? 4 : 1;
    expect([output.width, output.height]).toEqual(resized ? [2, 2] : [1, 1]);
    if (scenario === "reverse") {
        expect(output.space).toBe("srgb");
        expect(Array.from(output.data)).toEqual(Array.from({ length: pixels }, () => [35, 80, 165, 128]).flat());
    } else {
        expect(output.space).toBe("cmyk");
        const ink = scenario === "red-only" ? [35, 60, 180, 80] : [35, 80, 165, both ? 60 : 80];
        expect(Array.from(output.hueSamples!, value => Math.round(value * 255))).toEqual(Array.from({ length: pixels }, () => ink).flat());
        expect(Array.from(output.data.filter((_, i) => i % 4 === 3))).toEqual(Array(pixels).fill(scenario === "red-only" ? 192 : 128));
    }
});
