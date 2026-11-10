import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: -size 4x2 -depth 8 rgba:-
// [-set label 'frame A' -set comment 'shot 2' -set user:take 42] -compress None miff:-
const pixels = new Uint8Array(Buffer.from("1234abcdff0080ff1234abcd55660080".repeat(2), "hex"));
const fixtures = [
    {
        "header": "id=ImageMagick version=1.0\nclass=DirectClass colors=0 alpha-trait=Blend\nnumber-channels=4 number-meta-channels=0 channel-mask=0x0000000007ffffff\nmatte=True\ncolumns=4 rows=2 depth=8\ntype=TrueColor\ncolorspace=sRGB\ncompression=None  quality=0\npage=4x2+0+0\nrendering-intent=Perceptual\ngamma=0.454545\nred-primary=0.64,0.33 green-primary=0.3,0.6 blue-primary=0.15,0.06\nwhite-point=0.3127,0.329\ndate:create=2026-11-10T04:05:04+00:00\ndate:modify=2026-11-10T04:05:04+00:00\ndate:timestamp=2026-11-10T04:05:04+00:00\n\f\n:\u001a",
        "expected": "||"
    },
    {
        "header": "id=ImageMagick version=1.0\nclass=DirectClass colors=0 alpha-trait=Blend\nnumber-channels=4 number-meta-channels=0 channel-mask=0x0000000007ffffff\nmatte=True\ncolumns=4 rows=2 depth=8\ntype=TrueColor\ncolorspace=sRGB\ncompression=None  quality=0\npage=4x2+0+0\nrendering-intent=Perceptual\ngamma=0.454545\nred-primary=0.64,0.33 green-primary=0.3,0.6 blue-primary=0.15,0.06\nwhite-point=0.3127,0.329\ncomment={shot 2}\ndate:create=2026-11-10T04:05:04+00:00\ndate:modify=2026-11-10T04:05:04+00:00\ndate:timestamp=2026-11-10T04:05:04+00:00\nlabel={frame A}\nuser:take=42\n\f\n:\u001a",
        "expected": "frame A|shot 2|42"
    }
];

for (const { header, expected } of fixtures) {
    const input = new Uint8Array([...new TextEncoder().encode(header), ...pixels]);
    for (const mode of ["sync", "command"] as const) {
        it(`reads native MIFF properties through ${mode}: ${expected}`, async () => {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.miff", input);
            let stdout = "", stderr = "";
            const args = ["in.miff", "-format", "%l|%c|%[user:take]", "info:"];
            const result = mode === "sync" ? runMagickCliSync(args, new Map([["in.miff", input]])) : await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect({ ...result, ...("stdout" in result ? {} : { stdout, stderr }) }).toMatchObject({ exitCode: 0, stdout: expected, stderr: expected === "||" ? "magick: unknown image property '%[user:take]'\n" : "" });
        });
    }
    it(`preserves MIFF properties and pixels when writing PNG64: ${expected}`, async () => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.miff", input);
        await fs.writeFile("/out.png", new TextEncoder().encode("KEEP"));
        const result = await createMagickCommand().execute({
            command: "magick", args: ["in.miff", "PNG64:out.png"], cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        });
        expect(result.exitCode).toBe(0);
        const image = decodeImage(await fs.readFile("/out.png"));
        expect([...image.data16!]).toEqual([...pixels].map(value => value * 257));
        expect([image.properties?.label ?? "", image.properties?.comment ?? "", image.properties?.["user:take"] ?? ""].join("|")).toBe(expected);
    });
    it(`keeps structural MIFF fields out of image properties: ${expected}`, () => {
        const metadata = readImageMetadata(input);
        expect(metadata.properties ?? {}).not.toHaveProperty("columns");
        expect(metadata.properties ?? {}).not.toHaveProperty("id");
        expect(metadata.properties ?? {}).not.toHaveProperty("type");
        expect(metadata.properties ?? {}).not.toHaveProperty("gamma");
    });
}

for (const order of [fixtures, [...fixtures].reverse()]) {
    it(`keeps selected-frame properties separate when the first frame is ${order[0]!.expected}`, async () => {
        const input = new Uint8Array(order.flatMap(({ header }) => [...new TextEncoder().encode(header), ...pixels]));
        for (const page of [0, 1]) {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.miff", input);
            let stdout = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: [`in.miff[${page}]`, "-format", "%l|%c|%[user:take]", "info:"], cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }
            });
            expect(result.exitCode).toBe(0);
            expect(stdout).toBe(order[page]!.expected);
        }
    });
}
