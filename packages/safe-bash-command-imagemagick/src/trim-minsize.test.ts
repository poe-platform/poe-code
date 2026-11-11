import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runMagickCli, runMagickCliSync } from "./index.js";

it.each([
    ["-define", "trim:minSize=(4x3)"],
    ["-set", "option:trim:minSize", "(4x3)"],
    ["-define", "trim:minSize=4x3"],
    ["-set", "option:trim:minSize", "4x3"],
])("retains native trim dimensions and page with %j", async (...options) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
    const args = createCommandArguments([
        "-size", "6x5", "xc:white", "-fill", "red", "-draw", "rectangle 2,1 3,2",
        ...options, "-trim", "-format", "%wx%h %g;", "info:out",
    ]);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("4x3 6x5+2+1;");
});

for (const retained of [false, true]) {
    it.each([
        [[], 4, 4, 2, 1],
        [["-define", "trim:minSize=7x5"], 7, 5, 2, 1],
        [["-define", "trim:minSize=8x6"], 8, 6, 1, 1],
        [["-define", "trim:minSize=20x20"], 9, 7, 0, 0],
        [["-define", "trim:minSize=2x2"], 4, 4, 2, 1],
        [["-define", "trim:minSize=7"], 7, 4, 2, 1],
        [["-define", "trim:minSize=x6"], 4, 6, 2, 1],
        [["-define", "trim:minSize=7x5", "+define", "trim:minSize"], 4, 4, 2, 1],
    ] as const)(`retains minimum trim dimensions and source margins (retained=${retained}, %j)`, async (options, width, height, left, top) => {
        const pixels = new Uint8Array(9 * 7 * 4).fill(255);
        for (let y = 1; y <= 4; y++) for (let x = 2; x <= 5; x++) pixels.set([255, 0, 0, 255], (y * 9 + x) * 4);
        const input = await sharp(pixels, { raw: { width: 9, height: 7, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const backend = retained ? { filesystem, cwd: "/" } : files;
        expect((await runConvertCli(["input.png", ...options, "-trim", "out.png"], backend)).exitCode).toBe(0);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect((await runMagickCli(["identify", "-format", "%wx%h %X %Y %[page]", "out.png"], backend)).stdout).toBe(`${width}x${height} +${left} +${top} 9x7`);
        const expected = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) expected.set(pixels.subarray(((y + top) * 9 + left) * 4, ((y + top) * 9 + left + width) * 4), y * width * 4);
        expect(output.data).toEqual(expected);
    });
}

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const format of ["info", "PNG32"] as const) {
        it.each([
            ["3.9x2.1", 4, 2, 2, 2],
            ["1.5x3.5", 2, 4, 2, 1],
            ["4x2", 4, 2, 2, 2],
            ["2x4", 2, 4, 2, 1],
        ] as const)(`rounds trim minimum size %s to native pixels (${mode}, ${format})`, async (size, width, height, left, top) => {
            // Native ImageMagick 7.1.2-35 Q16-HDRI geometry and crop controls.
            const pixels = Array.from({ length: 30 }, () => [100, 120, 140]);
            pixels[1] = [102, 120, 140];
            pixels[14] = [26, 38, 54];
            pixels[15] = [50, 100, 130];
            pixels[20] = [69, 21, 90];
            pixels[21] = [200, 230, 17];
            const input = new Uint8Array([...new TextEncoder().encode("P6\n6 5\n255\n"), ...pixels.flat()]);
            const files = new Map([["/in.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile(name, bytes);
            const argv = ["/in.ppm", "-fuzz", "3%", "-define", `trim:minsize=${size}`, "-trim", "-format", "%wx%h %g", `${format}:/out`];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            if (format === "info") expect(new TextDecoder().decode(output)).toBe(`${width}x${height} 6x5+${left}+${top}`);
            else {
                const decoded = decodeImage(output);
                expect([decoded.width, decoded.height]).toEqual([width, height]);
                const expected = [];
                for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) expected.push(...pixels[y * 6 + x]!, 255);
                expect(decoded.data).toEqual(new Uint8Array(expected));
            }
        });
    }
}

for (const format of ["info", "gray"] as const) {
    it.each([
        { options: ["-define", "trim:minSize=-3x4"], minimum: false },
        { options: ["-define", "trim:minSize=+3x4"], minimum: false },
        { options: ["-set", "option:trim:minSize", "-3x4"], minimum: false },
        { options: ["-set", "option:trim:minSize", "+3x4"], minimum: false },
        { options: ["-define", "trim:minSize=0x4", "-define", "trim:minSize=-3x4"], minimum: false },
        { options: ["-define", "trim:minSize=0x4"], minimum: true },
        { options: [], minimum: false },
    ])(`matches native trim minimum geometry and pixels with $options (${format})`, async ({ options, minimum }) => {
        // ImageMagick 7.1.2-35 treats a leading sign as an offset, not a minimum dimension.
        const pixels = new Uint8Array(7 * 5 * 3);
        pixels.fill(255, (2 * 7 + 2) * 3, (2 * 7 + 5) * 3);
        const input = new Uint8Array([...new TextEncoder().encode("P6\n7 5\n255\n"), ...pixels]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = createCommandArguments([
            "/in.ppm", ...options, "-trim", "-format", "%wx%h%X%Y", "-depth", "8", `${format}:/out`,
        ]);
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = await fs.readFile("/out");
        if (format === "info") expect(new TextDecoder().decode(output)).toBe(minimum ? "3x4+2+1" : "3x1+2+2");
        else expect(output).toEqual(new Uint8Array(minimum ? [0, 0, 0, 255, 255, 255, 0, 0, 0, 0, 0, 0] : [255, 255, 255]));
    });
}

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["4x0x3", 4, 3, 1],
        ["3x3,2", 3, 3, 2],
        ["4x3x2", 4, 3, 1],
        ["4x0", 4, 1, 1],
        ["4x3", 4, 3, 1],
        ["3x3", 3, 3, 2],
        ["4x0x0x3", 4, 1, 1],
        ["4x0,3", 4, 1, 1],
    ] as const)(`reads native trim minimum height from extra fields in %s (${mode})`, async (size, width, height, left) => {
        // Native ImageMagick: two red pixels at (2,1) and (3,1) on a white 5x4 canvas.
        const pixels = Array.from({ length: 20 }, (_, index) => index === 7 || index === 8 ? [255, 0, 0] : [255, 255, 255]);
        const input = new Uint8Array([...new TextEncoder().encode("P6\n5 4\n255\n"), ...pixels.flat()]);
        const files = new Map([["/in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", "-define", `trim:minSize=${size}`, "-trim", "-write", "PNG32:/out.png", "-format", "%wx%h %g", "info:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(`${width}x${height} 5x4+${left}+1`);
        const image = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([image.width, image.height]).toEqual([width, height]);
        const expected = [];
        for (let y = 1; y < 1 + height; y++) for (let x = left; x < left + width; x++) expected.push(...pixels[y * 5 + x]!, 255);
        expect(image.data).toEqual(new Uint8Array(expected));
    });
}
