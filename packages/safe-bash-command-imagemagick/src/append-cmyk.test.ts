import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI inputs and +append reference.
const cmyk = Buffer.from("/9j/7gAOQWRvYmUAZAAAAAAC/9sAQwABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB/9sAQwEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB/8AAFAgAAgADBAERAAIRAQMRAQQRAP/EABQAAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAACQr/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADgQBAAIRAxEEAAA/AC/UYAHPQ//Z", "base64");
const rgb = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAAFCAIAAADg0arLAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTA6MTQ6NTgrMDA6MDAfdKHWAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDEwOjE0OjU4KzAwOjAwbikZagAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxMDoxNDo1OCswMDowMDk8OLUAAAAVSURBVAjXYxRIOMDAwMDEwMCAiwIAJ1IBOlg5yuEAAAAASUVORK5CYII=", "base64");
const native = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFAgMAAADwAc52AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAJUExURQBt1BBgwP///3sWxj4AAAABYktHRAJmC3xkAAAAB3RJTUUH6gsHCg47sxPakAAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0xMS0wN1QxMDoxNDo1OSswMDowMLkDqmIAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMTEtMDdUMTA6MTQ6NTkrMDA6MDDIXhLeAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTExLTA3VDEwOjE0OjU5KzAwOjAwn0szAQAAABBjYU52AAAAAwAAAAIAAAAAAAAAAMAKY+QAAAAQSURBVAjXY2B0YACilVAEABLPAz40M0n+AAAAAElFTkSuQmCC", "base64");

for (const mode of ["map", "sync", "filesystem", "command"] as const)
for (const direction of ["+append", "-append"])
for (const scenario of ["mixed", "reverse", "convert-first", "same-cmyk", "single-cmyk"] as const)
it(`appends CMYK pixels in operation order: ${mode}, ${direction}, ${scenario}`, async () => {
    const files = new Map<string, Uint8Array>([["/cmyk.jpg", cmyk], ["/rgb.png", rgb]]);
    const fs = createMemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const sources = scenario === "single-cmyk" ? ["/cmyk.jpg"]
        : scenario === "same-cmyk" ? ["/cmyk.jpg", "/cmyk.jpg"]
        : scenario === "reverse" ? ["/rgb.png", "/cmyk.jpg"] : ["/cmyk.jpg", "/rgb.png"];
    const args = [...sources, ...(scenario === "convert-first" ? ["-colorspace", "sRGB"] : []), direction, "-colorspace", "sRGB", "/out.png"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    expect(stderr).toBe("");
    const output = decodeImage(mode === "map" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    if (scenario === "mixed" && direction === "+append") {
        expect(output.data).toEqual(decodeImage(native).data);
    }
    const inputs = sources.map(source => decodeImage(files.get(source)!));
    const vertical = direction === "-append";
    const width = vertical ? Math.max(...inputs.map(image => image.width)) : inputs.reduce((sum, image) => sum + image.width, 0);
    const height = vertical ? inputs.reduce((sum, image) => sum + image.height, 0) : Math.max(...inputs.map(image => image.height));
    const expected = new Uint8Array(width * height * 4).fill(255);
    let cursor = 0;
    for (let n = 0; n < inputs.length; n++) {
        const input = inputs[n]!;
        for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
            const pixel = sources[n] === "/cmyk.jpg" && (scenario === "mixed" || scenario === "reverse")
                ? [0, 109, 212, 255] : input.data.subarray((y * input.width + x) * 4, (y * input.width + x + 1) * 4);
            expected.set(pixel, ((y + (vertical ? cursor : 0)) * width + x + (vertical ? 0 : cursor)) * 4);
        }
        cursor += vertical ? input.height : input.width;
    }
    expect([output.width, output.height]).toEqual([width, height]);
    expect(output.data).toEqual(expected);
});
