import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const retained of [false, true]) {
    it.each([
        { input: "gradient:black-white", box: "3x3+1+0", expected: [0,0,0,0,0, 0,128,128,128,0, 0,255,255,255,0] },
        { input: "radial-gradient:black-white", box: "3x3+1+0", expected: [0,180,128,180,0, 0,128,0,128,0, 0,180,128,180,0] },
        { input: "gradient:red-blue", box: "3x3+1+0", expected: [255,255,255,255,255, 255,128,128,128,255, 255,0,0,0,255] },
        { input: "gradient:black-white", box: "3x2+1+0", expected: [0,0,0,0,0, 0,128,128,128,0, 0,0,0,0,0] }
    ])(`clips $input to $box (retained=${retained})`, async ({ input, box, expected }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const result = await runConvertCli(["-size", "5x3", "-define", `gradient:bounding-box=${box}`, input, "PNG64:out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        // Native Q16-to-8-bit rounding can differ by one.
        Array.from(image.data).filter((_, i) => i % 4 === 0).forEach((value, i) => expect(Math.abs(value - expected[i]!)).toBeLessThanOrEqual(1));
        expect(Array.from(image.data).filter((_, i) => i % 4 === 3)).toEqual(Array(15).fill(255));
    });
    it.each(["+1+1", "50%", "3x2-1+1", "3x3+8+0"])(`rejects invalid bounds %s (retained=${retained})`, async box => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const result = await runConvertCli(["-size", "5x3", "-define", `gradient:bounding-box=${box}`, "gradient:black-white", "-depth", "8", "gray:-"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("no images");
    });

    it.each(["3x3+1+0", "+1+1", "50%"])(`resets the bounding box %s (retained=${retained})`, async box => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        await runConvertCli(["-size", "5x3", "-define", `gradient:bounding-box=${box}`, "+define", "gradient:bounding-box", "gradient:black-white", "PNG64:out.png"], retained ? { filesystem, cwd: "/" } : files);
        const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect(Array.from(image.data).filter((_, i) => i % 4 === 0)).toEqual([0,0,0,0,0, 128,128,128,128,128, 255,255,255,255,255]);
    });
}

it.each(["gradient", "radial-gradient"])("clips %s through the public command", async (input) => {
    const filesystem = new MemoryFileSystem();
    const args = createCommandArguments(["-size", "5x3", "-define", "gradient:bounding-box=3x3+1+0", `${input}:black-white`, "PNG64:out.png"]);
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }, fs: filesystem
    });
    expect(result.exitCode).toBe(0);
    const image = decodeImage(await filesystem.readFile("/out.png"));
    expect(Array.from(image.data.slice(20, 40))).toEqual(
        (input === "gradient" ? [0,128,128,128,0] : [0,128,0,128,0]).flatMap(value => [value,value,value,255])
    );
});

it.each(["+1+1", "50%"])("rejects %s through the public command without writing pixels", async box => {
    const filesystem = new MemoryFileSystem();
    const args = createCommandArguments(["-size", "5x3", "-define", `gradient:bounding-box=${box}`, "gradient:black-white", "-depth", "8", "gray:-"]);
    const stdout: unknown[] = [];
    const stderr: unknown[] = [];
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout.push(chunk); } },
        stderr: { async write(chunk) { stderr.push(chunk); } }, fs: filesystem
    });
    expect(result.exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.length).toBeGreaterThan(0);
});
