import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

const input = new Uint8Array(readFileSync(new URL("./fixtures/local-contrast-input.png", import.meta.url)));
// ImageMagick 7.1.2-35: input.png -local-contrast 12xSTRENGTH -depth 8 rgba:-.
for (const mode of ["buffered", "retained", "sync", "mogrify"] as const) {
    it.each([
        [0, 75, "e369a9697b0a7572058733213b77966d377979b8939c3de253de41214ae0b436"],
        [50, 110, "814df9f16d86e118a33ea6b0a29be37a9ad3c9aa0fd59800d791c780f3675b22"],
        [100, 145, "7de0a06a64cda2bc7934036568398a51b6bb569a147ff37485b754d7cf5a876a"],
    ] as const)(`matches every native local-contrast pixel at strength %s via ${mode}`, async (strength, blue, hash) => {
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const options = ["-local-contrast", `12x${strength}`, "-depth", "8"];
        const args = ["input.png", ...options, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : mode === "mogrify" ? await runMogrifyCli([...options, "input.png"], files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get(mode === "mogrify" ? "input.png" : "out.png")!);
        expect([output.width, output.height]).toEqual([64, 48]);
        expect([...output.data.slice(0, 4)]).toEqual([0, 0, blue, 255]);
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
        if (strength === 0) expect(output.data).toEqual(decodeImage(input).data);
    });
}

const nativeCases = [
    { options: ["-local-contrast", "0x100"], hash: "da810d7fe8ee1bf7c0a4dc0b5c3d37a732601ce6138d8f98a3bf85d45a1b4363" },
    { options: ["-local-contrast", "25x100"], hash: "d3c812e5d411cea903e44df47831d099ab339396a9fb4b5ff9fa330b1d3ad7b8" },
    { options: ["-local-contrast", "100x50"], hash: "2199fc240ded0128f5cf65d5162e88615b90f40644618c0f4dfd7d7deea660f0" },
    { options: ["-local-contrast", "-25x100"], hash: "d3c812e5d411cea903e44df47831d099ab339396a9fb4b5ff9fa330b1d3ad7b8" },
    { options: ["-local-contrast", "12"], hash: "db251dd1f7c2cc6ea269d1f11f7c10f15280be7f2f3ffa1b38591d94a7b81042" },
    { options: ["-local-contrast", "x50"], hash: "814df9f16d86e118a33ea6b0a29be37a9ad3c9aa0fd59800d791c780f3675b22" },
    { options: ["-local-contrast", "12x-50"], hash: "98df11d15595757bbed4a5a9f298d629f834745d15bdae440069f67e7d357920" },
    { options: ["-channel", "R", "-local-contrast", "25x100"], hash: "758e8b1f56fe1569e20a962f7b7a0ee8614012d0d05be8be537269ba87ee5040" },
    { options: ["-channel", "A", "-local-contrast", "25x100"], hash: "e369a9697b0a7572058733213b77966d377979b8939c3de253de41214ae0b436" },
    { options: ["-virtual-pixel", "tile", "-local-contrast", "25x100"], hash: "dad99225be1b8c45cd8d0421c5d1a9975b33a33067e55cd71b004015c0b40ab8" },
    { options: ["-background", "#204060", "-virtual-pixel", "background", "-local-contrast", "25x100"], hash: "f134549cb872f67c377ab2cd2f64513316c8980b6b1d3b6675f710c3f1083131" },
];

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(nativeCases)(`matches native local-contrast radius, defaults and settings via ${mode}: $options`, async ({ options, hash }) => {
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", ...options, "-depth", "8", "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
    });

    it(`preserves native 16-bit local contrast and untouched alpha via ${mode}`, async () => {
        const width = 32, height = 24;
        const data16 = Uint16Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? i * 73 % 65536 : (i * 173 + 4097) % 65536);
        const input = encodeImage({ width, height, data16, data: Uint8Array.from(data16, value => Math.round(value / 257)),
            format: "png", density: 72, channels: 4, hasAlpha: true, space: "srgb", depth: "ushort" }, { format: "png" }).data;
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-local-contrast", "100x50", "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect(output.data16).toBeDefined();
        expect(output.data16!.filter((_, i) => i % 4 === 3)).toEqual(data16.filter((_, i) => i % 4 === 3));
        const bytes = new Uint8Array(output.data16!.length * 2), view = new DataView(bytes.buffer);
        output.data16!.forEach((value, i) => view.setUint16(i * 2, value, true));
        expect(createHash("sha256").update(bytes).digest("hex")).toBe("e148e39fbcddc5ae01593acf7c49caab0a3e38c60279debd3c36a90f1321c373");
    });

    it.each(["", "bogus", "12x50junk", "12x50x3", "12xInfinity", "100000000x50"])(`rejects invalid or excessive local-contrast geometry %s before output via ${mode}`, async geometry => {
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-local-contrast", geometry, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr.toLowerCase()).toContain("local contrast");
        if (mode === "retained") await expect(filesystem.stat("/out.png")).rejects.toMatchObject({ code: "ENOENT" });
        else expect(files.has("out.png")).toBe(false);
    });
}

// Complete RGB raster hashes from native ImageMagick Q16-HDRI, with RGB8 input.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { channels: [], depth: "16", hash: "8aeb9a55e5eb8906d2e421dd71909a396aee50fe66826d8a061abc4802579784" },
        { channels: ["-channel", "R"], depth: "16", hash: "88837e278e41c09c73dde36b8ceb01e779181e54754d70aaf407f62182b533d0" },
        { channels: [], depth: "8", hash: "9b9e99b2e94c14fbc838a0cfdc793f71fd73aa214f40a3803d6da74aa000ebe9" },
        { channels: ["-channel", "R"], depth: "8", hash: "1def40ec8c7c502222d9242c8c75d173c905ef034db1c60a65e2597945b97682" },
    ])(`preserves calculated RGB8 local contrast at depth $depth with $channels via ${mode}`, async ({ channels, depth, hash }) => {
        const input = Uint8Array.from([...new TextEncoder().encode("P6\n7 5\n255\n"), ...Array.from({ length: 105 }, (_, i) => (i * 41 + 51) % 256)]);
        const files = new Map([["/input.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.ppm", input);
        const args = ["/input.ppm", ...channels, "-local-contrast", "10x20", "-endian", "MSB", "-depth", depth, "rgb:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output.length).toBe(105 * (depth === "16" ? 2 : 1));
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
