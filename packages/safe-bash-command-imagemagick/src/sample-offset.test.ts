import { expect, it } from "vitest";
import sharp, { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["75+25", "010101040404111111141414"],
        ["75-25", "010101040404111111141414"],
        ["75+25+10", "010101040404111111141414"],
        ["0", "010101040404111111141414"],
        ["75", "1313131717172b2b2b2f2f2f"],
        ["75x25+10", "0303030707071b1b1b1f1f1f"],
        ["75x+25", "1313131717172b2b2b2f2f2f"],
    ])(`${mode} matches native raw pixels for sample:offset=%s`, async (offset, expected) => {
        const input = Uint8Array.from(Array.from({ length: 48 }, (_, i) => [i + 1, i + 1, i + 1]).flat());
        const files = new Map([["in.rgb", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.rgb", input);
        const args = ["-size", "8x6", "-depth", "8", "rgb:in.rgb", "-define", `sample:offset=${offset}`, "-sample", "2x2!", "-depth", "8", "rgb:out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
    it.each([
        ["25,75", "54545b5b6262ffff7e7e85858c8cffffa8a8afafb6b6ffffd2d2d9d9e0e0ffff"],
        ["25/75", "54545b5b6262ffff7e7e85858c8cffffa8a8afafb6b6ffffd2d2d9d9e0e0ffff"],
        ["0,100", "54545b5b6262ffff696970707777ffffa8a8afafb6b6ffffbdbdc4c4cbcbffff"],
        ["1/2", "000007070e0effff2a2a31313838ffff54545b5b6262ffff7e7e85858c8cffff"],
        ["25x75", "54545b5b6262ffff7e7e85858c8cffffa8a8afafb6b6ffffd2d2d9d9e0e0ffff"],
        ["(25x75)", "54545b5b6262ffff7e7e85858c8cffffa8a8afafb6b6ffffd2d2d9d9e0e0ffff"],
        ["(25)x(75)", "54545b5b6262ffff7e7e85858c8cffffa8a8afafb6b6ffffd2d2d9d9e0e0ffff"],
        ["(25),75", "54545b5b6262ffff7e7e85858c8cffffa8a8afafb6b6ffffd2d2d9d9e0e0ffff"],
        ["25/(75)", "54545b5b6262ffff7e7e85858c8cffffa8a8afafb6b6ffffd2d2d9d9e0e0ffff"],
        ["0x100", "54545b5b6262ffff696970707777ffffa8a8afafb6b6ffffbdbdc4c4cbcbffff"],
        ["1x2", "000007070e0effff2a2a31313838ffff54545b5b6262ffff7e7e85858c8cffff"],
    ])(`${mode} matches native PNG64 pixels for sample:offset=%s`, async (offset, expected) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n4 3\n255\n"), ...Array.from({ length: 36 }, (_, i) => i * 7)]);
        const files = new Map([["in.ppm", input], ["out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const args = ["in.ppm", "-define", `sample:offset=${offset}`, "-sample", "2x2!", "PNG64:out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!);
        expect([output.width, output.height]).toEqual([2, 2]);
        expect(output.data16).toBeDefined();
        expect(Array.from(output.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(expected);
    });
}

// Pixel selections verified with native ImageMagick 7 Q16-HDRI.
for (const highDepth of [false, true])
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        [6, 4, [], [10, 30, 50, 130, 150, 170]],
        [6, 4, ["-define", "sample:offset=0x100"], [70, 80, 100, 190, 200, 220]],
        [6, 4, ["-define", "sample:offset=100x0"], [20, 40, 60, 80, 100, 120]],
        [6, 4, ["-define", "sample:offset=25x75"], [70, 90, 110, 190, 210, 230]],
        [6, 4, ["-define", "sample:offset=x100"], [70, 80, 100, 190, 200, 220]],
        [6, 4, ["-define", "sample:offset=200x200"], [220, 240, 240, 220, 240, 240]],
        [6, 4, ["-define", "sample:offset=100"], [80, 100, 120, 200, 220, 240]],
        [6, 4, ["-define", "sample:offset=100x100", "+define", "sample:offset"], [10, 30, 50, 130, 150, 170]],
        [7, 5, ["-define", "sample:offset=0x0"], [1, 3, 5, 15, 17, 19]],
        [7, 5, ["-define", "sample:offset=100x100"], [17, 19, 21, 31, 33, 35]],
        [7, 5, ["-define", "sample:offset=50x50"], [9, 11, 13, 23, 25, 27]],
    ] as [number, number, string[], number[]][])(`${mode}, highDepth=${highDepth} samples %ix%i with %j`, async (width, height, defines, expected) => {
        const pixels = Array.from({ length: width * height }, (_, i) => (i + 1) * (width === 6 ? 10 : 1));
        let input = await sharp(Uint8Array.from(pixels.flatMap(v => [v, v, v])), { raw: { width, height, channels: 3 } }).png().toBuffer();
        if (highDepth) {
            input = encodeImage({ ...decodeImage(input), data16: Uint16Array.from(pixels.flatMap(v => [v * 257 + 1, v * 257 + 1, v * 257 + 1, 65535])) }, { format: "png" }).data;
        }
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-repage", `${width * 2}x${height * 2}+0+0`, ...defines, "-sample", "3x2!", "out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([3, 2]);
        expect([...output.data]).toEqual(expected.flatMap(v => [v, v, v, 255]));
        expect(output.virtualCanvas).toEqual({ width: 6, height: 4, x: 0, y: 0 });
        if (highDepth) expect([...output.data16!]).toEqual(expected.flatMap(v => [v * 257 + 1, v * 257 + 1, v * 257 + 1, 65535]));
    });
}
