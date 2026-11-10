import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { rawRasterInput } from "./raw-rgb.js";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick: Plane uses RGB order even for BGR coders; RGBO Line ignores opacity.
const fixtures = [
    ["rgb", "None", "1f364dff647b92ffa9c0d7ffee051cff"],
    ["rgb", "Line", "1f4d7bff366492ffa9d705ffc0ee1cff"],
    ["rgb", "Plane", "1f7bd7ff3692eeff4da905ff64c01cff"],
    ["rgba", "None", "1f364d647b92a9c0d7ee051c334a6178"],
    ["rgba", "Line", "1f4d7ba9366492c0d7053361ee1c4a78"],
    ["rgba", "Plane", "1f7bd7333692ee4a4da9056164c01c78"],
    ["rgbo", "None", "1f364d9b7b92a93fd7ee05e3334a6187"],
    ["rgbo", "Line", "1f4d7bff366492ffd70533ffee1c4aff"],
    ["rgbo", "Plane", "1f7bd7333692ee4a4da9056164c01c78"],
    ["bgr", "None", "4d361fff927b64ffd7c0a9ff1c05eeff"],
    ["bgr", "Line", "7b4d1fff926436ff05d7a9ff1ceec0ff"],
    ["bgr", "Plane", "1f7bd7ff3692eeff4da905ff64c01cff"],
    ["bgra", "None", "4d361f64a9927bc005eed71c614a3378"],
    ["bgra", "Line", "7b4d1fa9926436c03305d7614a1cee78"],
    ["bgra", "Plane", "1f7bd7333692ee4a4da9056164c01c78"],
    ["bgro", "Line", "7b4d1fa9926436c03305d7614a1cee78"],
    ["bgro", "Plane", "1f7bd7333692ee4a4da9056164c01c78"]
] as const;
for (const mode of ["command", "stream", "buffered", "sync"] as const) {
    it.each(fixtures)(`${mode} decodes %s %s to packed RGBA`, async (coder, interlace, expected) => {
        const input = Buffer.from("1f364d647b92a9c0d7ee051c334a6178", "hex").subarray(0, 4 * coder!.length);
        const files = new Map<string, Uint8Array>([["/in", input], ["/out", Buffer.from("KEEP")]]);
        const argv = ["-size", "2x2", "-depth", "8", "-interlace", interlace!, `${coder}:${mode === "stream" ? "-" : "/in"}`, "-interlace", "None", "-depth", "8", "rgba:/out"];
        if (mode === "buffered" || mode === "sync") {
            expect(await (mode === "sync" ? runMagickCliSync(argv, files) : runMagickCli(argv, files))).toMatchObject({ exitCode: 0, stderr: "" });
            expect(Buffer.from(files.get("/out")!).toString("hex")).toBe(expected);
        } else {
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal,
                stdin: (async function* () { for (let i = 0; i < input.length; i += 3) yield input.subarray(i, i + 3); })(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(stderr).toBe("");
            expect(result.exitCode).toBe(0);
            expect(Buffer.from(await fs.readFile("/out")).toString("hex")).toBe(expected);
        }
    });
}

for (const [coder, interlace, hex] of fixtures) {
    if (coder === "rgb" || interlace === "None") continue;
    it(`reads partial ${coder} ${interlace} bytes with offsets and multiple frames`, () => {
        const frame = Buffer.from("1f364d647b92a9c0d7ee051c334a6178", "hex").subarray(0, 4 * coder.length);
        const input = Buffer.concat([Buffer.from("skip"), frame, frame]);
        const raw = rawRasterInput(2, 2, 8, "lsb", input.length, coder, 4, interlace === "Line" ? "line" : "plane");
        const header = coder === "bgr" ? "P6\n2 2\n255\n" : "P7\nWIDTH 2\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n";
        const pixels = Buffer.from(hex, "hex");
        const expected = Buffer.concat([Buffer.from(header), coder === "bgr" ? pixels.filter((_, i) => i % 4 !== 3) : pixels]);
        expect(raw.pages).toBe(2);
        for (const page of [0, 1]) for (let position = 0; position < raw.size; position++) {
            const length = Math.min(3, raw.size - position), steps = raw.read(position, length, page);
            let next = steps.next();
            while (!next.done) {
                expect(next.value.length).toBeLessThanOrEqual(8192);
                next = steps.next(input.subarray(next.value.position, next.value.position + next.value.length));
            }
            expect(Buffer.from(next.value)).toEqual(expected.subarray(position, position + length));
        }
    });
}
