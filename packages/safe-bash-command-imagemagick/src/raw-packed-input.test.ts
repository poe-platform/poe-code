import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";
import { rawRasterInput } from "./raw-rgb.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, with each input row padded to a byte.
const cases: { coder: string; depth: number; input: string; output: string; size?: string; selector?: string; exitCode?: number }[] = [
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
