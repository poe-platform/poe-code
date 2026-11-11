import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "public"]) {
    it.each([
        { inputs: ["xc:red", "xc:blue"], options: [], output: "histogram:info:", expected: "0/0/1;1/0/1;" },
        { inputs: ["xc:red", "xc:blue"], options: ["-scene", "4"], output: "histogram:info:", expected: "4/0/1;5/0/1;" },
        { inputs: ["xc:red", "xc:blue"], options: [], output: "info:", expected: "0/0/2;1/1/2;" },
        { inputs: ["xc:red"], options: [], output: "histogram:info:", expected: "0/0/1;" }
    ])(`formats individual histogram plot positions: $output $options $inputs (${mode})`, async ({ inputs, options, output, expected }) => {
        const args = [...inputs, ...options, "-format", "%s/%p/%n;", output];
        const filesystem = new MemoryFileSystem();
        if (mode === "public") {
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect({ exitCode: result.exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
        } else {
            expect(await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : new Map())).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
        }
    });
}

for (const retained of [false, true]) {
    it.each(["png", "miff"])(`matches native fractional histogram bars in %s (retained=${retained})`, async format => {
        const input = Buffer.concat([Buffer.from("P6\n4 2\n255\n"), Buffer.from("ff0000".repeat(4) + "00ff00".repeat(2) + "0000ff000000", "hex")]);
        const files = new Map([["in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const output = `out.${format}`;
        expect(await runConvertCli(["in.ppm", `histogram:${output}`], retained ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = retained ? await filesystem.readFile(`/${output}`) : files.get(output)!;
        const data = await sharp(bytes).removeAlpha().raw().toBuffer();
        expect(createHash("sha256").update(data).digest("hex")).toBe("bfb0b0e973bed890479ea6ddac165d9c6eabe52b3e76b2678512b737a5530e5b");
    });
}

it.each([false, true])("writes the native RGB histogram chart (retained=%s)", async retained => {
    const pixels = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255]);
    const input = await sharp(pixels, { raw: { width: 6, height: 1, channels: 3 } }).png().toBuffer();
    const files = new Map([["rgb.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/rgb.png", input);
    const result = await runConvertCli(["rgb.png", "histogram:out.png"], retained ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const bytes = retained ? await filesystem.readFile("/out.png") : files.get("out.png");
    expect(bytes).toBeDefined();
    const { data, info } = await sharp(bytes!).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([256, 200, 3]);
    const counts: Record<string, number> = {};
    let mismatchedPixels = 0;
    for (let i = 0; i < data.length; i += 3) {
        const color = [...data.subarray(i, i + 3)].join(",");
        counts[color] = (counts[color] ?? 0) + 1;
        const x = i / 3 % 256, y = Math.floor(i / 3 / 256);
        const heights = x === 0 ? [120, 160, 200] : x === 255 ? [120, 80, 40] : [0, 0, 0];
        if (heights.some((height, channel) => data[i + channel] !== (y >= 200 - height ? 255 : 0))) mismatchedPixels++;
    }
    expect(mismatchedPixels).toBe(0);
    expect(counts).toEqual({ "0,0,0": 50880, "255,255,255": 160, "0,255,255": 40, "255,0,0": 40, "255,255,0": 40, "0,0,255": 40 });
});

it("streams an explicitly encoded histogram to stdout", async () => {
    const filesystem = new MemoryFileSystem(), chunks: Uint8Array[] = [];
    const result = await runConvertCli(["xc:red", "histogram:png:-"], { filesystem, cwd: "/", stdout: { async write(bytes) { chunks.push(bytes.slice()); } } });
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const bytes = Buffer.concat(chunks);
    expect(await sharp(bytes).metadata()).toMatchObject({ format: "png", width: 256, height: 200 });
    expect(await filesystem.readdir("/")).toEqual([]);
});

it("preserves the previous histogram file when publication is cancelled", async () => {
    const fs = new MemoryFileSystem(), controller = new AbortController(), reason = new Error("cancel histogram publication");
    const previous = new TextEncoder().encode("previous contents");
    await fs.writeFile("/out.png", previous);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "createStagedFile") return async (...args: Parameters<typeof fs.createStagedFile>) => {
            const staged = await fs.createStagedFile(...args), writer = staged.writer!;
            return { ...staged, writer: { ...writer, async write(...args: Parameters<typeof writer.write>) { await writer.write(...args); controller.abort(reason); }, finish: writer.finish.bind(writer) } };
        };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(runConvertCli(["xc:red", "histogram:out.png"], { filesystem, cwd: "/" }, undefined, controller.signal)).rejects.toBe(reason);
    expect(await fs.readFile("/out.png")).toEqual(previous);
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["out.png"]);
});
