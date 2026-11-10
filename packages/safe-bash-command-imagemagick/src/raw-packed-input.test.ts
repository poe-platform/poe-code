import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";
import { rawNetpbmInput } from "./raw-rgb.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, with each input row padded to a byte.
const cases: { coder: string; depth: number; input: string; output: string; size?: string; selector?: string; exitCode?: number }[] = [
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
    const raw = rawNetpbmInput(2, 2, 2, "msb", input.length, 3);
    for (let position = 0; position < raw.size; position++) {
        const length = Math.min(7, raw.size - position), steps = raw.read(position, length);
        let next = steps.next();
        while (!next.done) next = steps.next(input.subarray(next.value.position, next.value.position + next.value.length));
        expect(Buffer.from(next.value)).toEqual(expected.subarray(position, position + length));
    }
});

it("bounds packed input reads for wide rows", () => {
    const input = new Uint8Array(8193).fill(0x55);
    const raw = rawNetpbmInput(21847, 1, 1, "lsb", input.length, 3);
    const steps = raw.read(0, raw.size);
    let next = steps.next();
    while (!next.done) {
        expect(next.value.length).toBeLessThanOrEqual(8192);
        next = steps.next(input.subarray(next.value.position, next.value.position + next.value.length));
    }
    const expected = Buffer.concat([Buffer.from("P6\n21847 1\n255\n"), Buffer.from(Array.from({ length: 65541 }, (_, i) => i % 2 * 255))]);
    expect(Buffer.from(next.value)).toEqual(expected);
});
