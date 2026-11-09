import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

const corner = [0,128,255,255,255,128,180,255,255,255,255,255,255,255,255];
for (const retained of [false, true]) {
    it.each([
        { center: "0,0", options: [], expected: corner, minimum: 0 },
        { center: "4,2", options: [], expected: [...corner].reverse(), minimum: 14 },
        { center: "0,0", options: ["-define", "gradient:vector=0,0,2,0"], expected: corner, minimum: 0 },
        { center: "0,0", options: ["+define", "gradient:center"], expected: [255,180,128,180,255,255,128,0,128,255,255,180,128,180,255], minimum: 7 }
    ])(`places radial center=$center $options (retained=${retained})`, async ({ center, options, expected, minimum }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        expect(await runConvertCli(["-size", "5x3", "-define", `gradient:center=${center}`, ...options, "radial-gradient:black-white", "PNG64:out.png"], retained ? { filesystem, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        const red = Array.from(image.data).filter((_, i) => i % 4 === 0);
        expect(red.indexOf(Math.min(...red))).toBe(minimum);
        expect(red).toHaveLength(expected.length);
        red.forEach((value, i) => expect(Math.abs(value - expected[i]!)).toBeLessThanOrEqual(1));
    });
}

it("honors the radial center through the public command", async () => {
    const filesystem = new MemoryFileSystem();
    const args = createCommandArguments(["-size", "5x3", "-define", "gradient:center=0,0", "radial-gradient:black-white", "PNG64:out.png"]);
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }, fs: filesystem
    });
    expect(result.exitCode).toBe(0);
    const red = Array.from(decodeImage(await filesystem.readFile("/out.png")).data).filter((_, i) => i % 4 === 0);
    expect(red).toHaveLength(corner.length);
    // Q16-to-8-bit decoding can differ from native rounding by one.
    red.forEach((value, i) => expect(Math.abs(value - corner[i]!)).toBeLessThanOrEqual(1));
    expect(red.indexOf(Math.min(...red))).toBe(0);
});
