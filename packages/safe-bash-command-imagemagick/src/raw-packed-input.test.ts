import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";
import { rawRasterInput } from "./raw-rgb.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, with each input row padded to a byte.
const cases: { coder: string; depth: number; input: string; output: string; size?: string; selector?: string; exitCode?: number }[] = [
    { coder: "rgba", depth: 10, input: "0108c4545c67626aba22cdbbffff87120d156400", output: "012345176789ab88cdefffe112345600" },
    { coder: "bgra", depth: 10, input: "0108c4545c67626aba22cdbbffff87120d156400", output: "012345176789ab88cdefffe112345600" },
    { coder: "rgbo", depth: 10, input: "0108c4545c67626aba22cdbbffff87120d156400", output: "012345e86789ab77cdefff1e123456ff" },
    { coder: "bgr", depth: 10, input: "0108c45467626abacdcbbfff1210d156", output: "452301ffaa621affff2fcdff4511c4ff" },
    { coder: "rgba", depth: 12, input: "010232454171676898aba888cdcefefffe1d121343565000", output: "012345176789ab88cdefffe112345600" },
    { coder: "bgra", depth: 12, input: "010232454171676898aba888cdcefefffe1d121343565000", output: "45230117ab896788ffefcde156341200" },
    { coder: "rgbo", depth: 12, input: "010232454171676898aba888cdcefefffe1d121343565000", output: "012345e86789ab77cdefff1e123456ff" },
    { coder: "rgbo", depth: 12, input: "010232454000676898aba000cdcefefff000121343565000", output: "012345ff6789abffcdefffff123456ff" },
    { coder: "bgr", depth: 12, input: "010232454676898abacdcefefff121343565", output: "452301ffab8967ffffefcdff563412ff" },
    { coder: "rgba", depth: 16, input: "010123234545171767678989abab8888cdcdefefffffe1e11212343456560000", output: "012345176789ab88cdefffe112345600" },
    { coder: "bgr", depth: 10, input: "0108c45467626abacdcbbfff1210d1", output: "4b454550", exitCode: 1 },
    { coder: "rgba", depth: 10, input: "0108c4545c67626aba22cdbbffff87120d1564", output: "4b454550", exitCode: 1 },
    { coder: "bgra", depth: 12, input: "010232454171676898aba888cdcefefffe1d1213435650", output: "4b454550", exitCode: 1 },
    { coder: "rgbo", depth: 12, input: "010232454000676898aba000cdcefefff0001213435650", output: "4b454550", exitCode: 1 },
    { coder: "rgba", depth: 4, input: "1f364d647b92a9c0", output: "11ff336644dd664477bb9922aa99cc00" },
    { coder: "rgbo", depth: 4, input: "1f364d647b92a9c0", output: "11ff339944dd66bb77bb99ddaa99ccff" },
    { coder: "bgr", depth: 4, input: "1f364d647b92", output: "33ff11ffdd4466ff774466ff2299bbff" },
    { coder: "bgra", depth: 4, input: "1f364d647b92a9c0", output: "33ff116666dd444499bb7722cc99aa00" },
    { coder: "bgro", depth: 4, input: "1f364d647b92a9c0", output: "33ff119966dd44bb99bb77ddcc99aaff" },
    { coder: "graya", depth: 4, input: "1f364d64", output: "111111ff33333366444444dd66666644" },
    { coder: "cmyk", depth: 4, input: "1f364d647b92a9c0", output: "8f007aff891970ff763b58ff556633ff" },
    { coder: "cmyka", depth: 4, input: "1f364d647b92a9c0d7ee", output: "8f007a44125264bb295822cc110209ee" },
    { coder: "rgba", depth: 8, input: "1f364d647b92a9c0d7ee051c334a6178", output: "1f364d647b92a9c0d7ee051c334a6178" },
    { coder: "bgr", depth: 4, size: "1x2", input: "1f3e64df", output: "33ff11ffdd4466ff" },
    { coder: "cmyka", depth: 4, size: "1x2", input: "1f364e647b9f", output: "8f007a4429322499" },
    { coder: "rgba", depth: 4, size: "2x2+1", selector: "[1]", input: "ff00000000000000001f364d647b92a9c0", output: "11ff336644dd664477bb9922aa99cc00" },
    { coder: "rgba", depth: 4, input: "1f364d647b92a9", output: "4b454550", exitCode: 1 },
    { coder: "bgr", depth: 4, input: "1f364d647b", output: "4b454550", exitCode: 1 },
    { coder: "graya", depth: 4, input: "1f364d", output: "4b454550", exitCode: 1 },
    { coder: "cmyk", depth: 4, input: "1f364d647b92a9", output: "4b454550", exitCode: 1 },
    { coder: "cmyka", depth: 4, input: "1f364d647b92a9c0d7", output: "4b454550", exitCode: 1 },
    { coder: "rgb", depth: 1, input: "093e", output: "000000ff00ff00ff0000ffffffffffff" },
    { coder: "rgb", depth: 2, input: "093e73a8", output: "0000aaff5500ffff55ff00ffffaaaaff" },
    { coder: "rgb", depth: 4, input: "093e73a8dd12", output: "009933ffee7733ffaa88ddffdd1122ff" },
    { coder: "gray", depth: 1, input: "093e", output: "000000ff000000ff000000ff000000ff" },
    { coder: "gray", depth: 2, input: "093e", output: "000000ff000000ff000000ffffffffff" },
    { coder: "gray", depth: 4, input: "093e", output: "000000ff999999ff333333ffeeeeeeff" },
    { coder: "gray", depth: 8, input: "093e73a8", output: "090909ff3e3e3eff737373ffa8a8a8ff" },
    ...[
        { depth: 3, input: "111213", output: "000000ff929292ff494949ff242424ff242424ff000000ff494949ff6d6d6dff" },
        { depth: 5, input: "1112131415", output: "101010ff212121ff4a4a4aff080808ff313131ff292929ff000000ffadadadff" },
        { depth: 6, input: "111213141516", output: "101010ff454545ff202020ff4d4d4dff141414ff040404ff515151ff595959ff" },
        { depth: 7, input: "11121314151617", output: "101010ff898989ff858585ff626262ff404040ffa9a9a9ff585858ff2e2e2eff" },
        { depth: 4, input: "11121314", output: "111111ff111111ff111111ff222222ff111111ff333333ff111111ff444444ff" },
        { depth: 8, input: "1112131415161718", output: "111111ff121212ff131313ff141414ff151515ff161616ff171717ff181818ff" }
    ].flatMap(fixture => [
        { ...fixture, coder: "gray", size: "8x1" },
        { ...fixture, coder: "gray", size: "7x2", input: fixture.input.slice(0, Math.ceil(7 * fixture.depth / 8) * 2).repeat(2), output: fixture.output.slice(0, 7 * 8).repeat(2) },
        { ...fixture, coder: "gray", size: "8x1+1", selector: "[1]", input: "ff" + fixture.input.repeat(2) },
        { ...fixture, coder: "gray", size: "8x1", input: fixture.input.slice(0, -2), output: "4b454550", exitCode: 1 }
    ]),
    { coder: "rgb", depth: 1, input: "", output: "4b454550", exitCode: 1 },
    { coder: "rgb", depth: 2, input: "093e", output: "4b454550", exitCode: 1 },
    { coder: "gray", depth: 4, input: "09", output: "4b454550", exitCode: 1 },
    { coder: "rgb", depth: 1, input: "093e73", output: "4b454550", exitCode: 1 },
    { coder: "rgb", depth: 4, input: "093e73a8dd1209", output: "009933ffee7733ffaa88ddffdd1122ff" },
    { coder: "gray", depth: 2, input: "093ee41b", output: "000000ff000000ff000000ffffffffffffffffffaaaaaaff000000ff555555ff" },
    { coder: "gray", depth: 2, size: "2x2+1", selector: "[1]", input: "ff093ee41b", output: "ffffffffaaaaaaff000000ff555555ff" }
];

for (const mode of ["file", "stream", "sync"] as const) {
    it.each(cases)(`${mode} decodes $depth-bit $coder rows`, async ({ coder, depth, input, output, size = "2x2", selector = "", exitCode = 0 }) => {
        const bytes = Buffer.from(input, "hex"), keep = new TextEncoder().encode("KEEP");
        const argv = ["-size", size, "-depth", String(depth), `${coder}:${mode === "stream" ? "-" : "/raw.bin"}${selector}`, "-append", "-depth", "8", "rgba:/out"];
        let result: { exitCode: number }, stderr: string, actual: Uint8Array;
        if (mode === "sync") {
            const files = new Map<string, Uint8Array>([["/raw.bin", bytes], ["/out", keep]]);
            const sync = runMagickCliSync(argv, files);
            result = sync;
            stderr = sync.stderr;
            actual = files.get("/out")!;
        } else {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/raw.bin", bytes);
            await fs.writeFile("/out", keep);
            const args = createCommandArguments(argv);
            stderr = "";
            result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal,
                stdin: (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
            actual = await fs.readFile("/out");
        }
        expect(result.exitCode).toBe(exitCode);
        if (exitCode) expect(stderr).toContain(`unexpected end-of-file in ${coder.toUpperCase()} input`);
        else expect(stderr).toBe("");
        expect(Buffer.from(actual).toString("hex")).toBe(output);
    });
}

it("supports partial reads across packed RGB row boundaries", () => {
    const input = Buffer.from("093e73a8", "hex");
    const expected = Buffer.concat([Buffer.from("P6\n2 2\n255\n"), Buffer.from("0000aa5500ff55ff00ffaaaa", "hex")]);
    const raw = rawRasterInput(2, 2, 2, "msb", input.length, 3);
    for (let position = 0; position < raw.size; position++) {
        const length = Math.min(7, raw.size - position), steps = raw.read(position, length);
        let next = steps.next();
        while (!next.done) next = steps.next(input.subarray(next.value.position, next.value.position + next.value.length));
        expect(Buffer.from(next.value)).toEqual(expected.subarray(position, position + length));
    }
});

it("bounds packed input reads for wide rows", () => {
    const input = new Uint8Array(8193).fill(0x55);
    const raw = rawRasterInput(21847, 1, 1, "lsb", input.length, 3);
    const steps = raw.read(0, raw.size);
    let next = steps.next();
    while (!next.done) {
        expect(next.value.length).toBeLessThanOrEqual(8192);
        next = steps.next(input.subarray(next.value.position, next.value.position + next.value.length));
    }
    const expected = Buffer.concat([Buffer.from("P6\n21847 1\n255\n"), Buffer.from(Array.from({ length: 65541 }, (_, i) => i % 2 * 255))]);
    expect(Buffer.from(next.value)).toEqual(expected);
});

it.each([
    { layout: "rgba", input: "1f364d64", samples: "11ff336644dd6644" },
    { layout: "rgbo", input: "1f364d64", samples: "11ff339944dd66bb" },
    { layout: "bgr", input: "1f3e64df", samples: "33ff11dd4466" },
    { layout: "bgra", input: "1f364d64", samples: "33ff116666dd4444" },
    { layout: "bgro", input: "1f364d64", samples: "33ff119966dd44bb" },
    { layout: 2, input: "1f36", samples: "11ff3366" },
    { layout: 4, input: "1f364d64", samples: "11ff336644dd6644" },
    { layout: 5, input: "1f364e647b9f", samples: "11ff336644664477bb99" }
] as const)("reads partial 4-bit $layout pixels across padded rows and selected frames", ({ layout, input, samples }) => {
    const frame = Buffer.from(input, "hex"), source = Buffer.concat([Buffer.from("PAD"), frame, frame]);
    const expected = Buffer.from(samples, "hex");
    for (const endian of ["msb", "lsb"]) {
        const raw = rawRasterInput(1, 2, 4, endian, source.length, layout, 3);
        expect(raw.pages).toBe(2);
        const headerLength = raw.size - expected.length;
        for (let position = 0; position < expected.length; position++) {
            const length = Math.min(3, expected.length - position), steps = raw.read(headerLength + position, length, 1);
            let next = steps.next();
            while (!next.done) next = steps.next(source.subarray(next.value.position, next.value.position + next.value.length));
            expect(Buffer.from(next.value)).toEqual(expected.subarray(position, position + length));
        }
    }
});

it("keeps BGR channel order across bounded packed reads", () => {
    const input = Buffer.from("123456".repeat(3001), "hex");
    const raw = rawRasterInput(6002, 1, 4, "lsb", input.length, "bgr");
    const steps = raw.read(0, raw.size);
    let next = steps.next();
    while (!next.done) {
        expect(next.value.length).toBeLessThanOrEqual(8192);
        next = steps.next(input.subarray(next.value.position, next.value.position + next.value.length));
    }
    expect(Buffer.from(next.value)).toEqual(Buffer.concat([
        Buffer.from("P6\n6002 1\n255\n"), Buffer.from("332211665544".repeat(3001), "hex")
    ]));
});

it.each([
    [3, "111213", "009249242400496d"],
    [5, "1112131415", "10214a08312900ad"],
    [6, "111213141516", "1045204d14045159"],
    [7, "11121314151617", "1089856240a9582e"]
] as const)("reads bounded and partial %i-bit GRAY rows with offsets and scenes", (depth, hex, decoded) => {
    const width = 1031, row = Buffer.from(hex.repeat(129), "hex");
    const input = Buffer.concat([Buffer.from("skip"), row, row, row, row]);
    const pixels = Buffer.from(decoded.repeat(129), "hex").subarray(0, width);
    const header = Buffer.from(`P5\n${width} 2\n255\n`);
    const expected = Buffer.concat([header, pixels, pixels]);
    for (const endian of ["msb", "lsb"]) {
        const raw = rawRasterInput(width, 2, depth, endian, input.length, 1, 4);
        expect(raw.pages).toBe(2);
        expect(raw.size).toBe(expected.length);
        const reads = [[0, raw.size], ...[0, 1, 1023, 1024, 1029, 1030, 1031, 2054].map(pixel => [header.length + pixel, 7])];
        for (const [position, length] of reads) {
            const steps = raw.read(position!, length!, 1);
            let next = steps.next();
            while (!next.done) {
                expect(next.value.length).toBeLessThanOrEqual(1024 * depth / 8 + 1);
                next = steps.next(input.subarray(next.value.position, next.value.position + next.value.length));
            }
            expect(Buffer.from(next.value)).toEqual(expected.subarray(position!, position! + length!));
        }
    }
});
