import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n32 16\n255\n"), Buffer.from(Array.from({ length: 32 * 16 }, (_, i) => {
    const x = i % 32, y = Math.floor(i / 32);
    return x >= 3 && x < 29 && [3, 4, 8, 9].includes(y - Math.floor(x / 7)) ? [10, 30, 60] : [240, 247, 252];
}).flat())]);

// ImageMagick 7.1.2-35 Q16-HDRI references for the same PPM bytes.
for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each([
        { name: "unscaled", options: [], geometry: "35x21 35x21-1-4", bytes: 2205, hash: "dd640e628393f0331549b1d6da16a19469316f822b32ad4ff14df79955af8f1c" },
        { name: "doubled", options: ["-define", "distort:scale=2"], geometry: "70x42 70x42-1-7", bytes: 8820, hash: "5d9ef670c6371aeca01ceac8b0335d4bf67274caf38e677f0b8839d800e10c73" },
        { name: "negative scale", options: ["-define", "distort:scale=-2"], geometry: "70x42 70x42-1-7", bytes: 8820, hash: "5d9ef670c6371aeca01ceac8b0335d4bf67274caf38e677f0b8839d800e10c73" },
        { name: "halved", options: ["-define", "distort:scale=0.5"], geometry: "18x11 18x11+0-1", bytes: 594, hash: "028f60cf14a0b2164d74922f46f99401a762e620b21f1c379a1502807eaf8bd9" },
        { name: "positioned page", options: ["-set", "page", "64x48+4+3", "-define", "distort:scale=2"], geometry: "72x42 144x126+6-1", bytes: 9072, hash: "05dd8100362f3aac77200130940615057b345bfd46b50d0ab4e9fffb3094ece9" },
        { name: "Point filter", options: ["-filter", "Point", "-define", "distort:scale=2"], geometry: "70x42 70x42-1-7", bytes: 8820, hash: "e2897ed4ba5f5743106fde121165b6818380f2926eac260d8e87a6cb227d5934" },
        { name: "reset", options: ["-define", "distort:scale=2", "+define", "distort:scale"], geometry: "35x21 35x21-1-4", bytes: 2205, hash: "dd640e628393f0331549b1d6da16a19469316f822b32ad4ff14df79955af8f1c" }
    ])(`matches native $name deskew geometry and pixels (${mode})`, async ({ options, geometry, bytes, hash }) => {
        const files = new Map<string, Uint8Array>([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const operations = [...options, "-deskew", "40%", "-depth", "8", "-write", "rgb:/pixels",
            "-format", "%wx%h %g %[deskew:angle]", "-write", "info:/geometry"];
        const args = ["/in.ppm", ...operations, "null:"];
        let stderr = "";
        const result = mode === "public" ? { ...await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }), stderr } : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        const pixels = mode === "public" || mode === "retained" ? await fs.readFile("/pixels") : files.get("/pixels")!;
        const page = mode === "public" || mode === "retained" ? await fs.readFile("/geometry") : files.get("/geometry")!;
        expect(new TextDecoder().decode(page)).toBe(`${geometry} -5.3558250428551908`);
        expect(pixels.length).toBe(bytes);
        expect(createHash("sha256").update(pixels).digest("hex")).toBe(hash);
    });
}

it("scales deskew through mogrify", async () => {
    const files = new Map([["/in.png", encodeImage(decodeImage(input), { format: "png" }).data]]);
    const result = await runMogrifyCli(["-define", "distort:scale=2", "-deskew", "40%", "/in.png"], files);
    expect(result.exitCode, result.stderr).toBe(0);
    const image = decodeImage(files.get("/in.png")!);
    expect([image.width, image.height, image.virtualCanvas]).toEqual([70, 42, { width: 70, height: 42, x: -1, y: -7 }]);
    expect(createHash("sha256").update(image.data.filter((_, i) => i % 4 !== 3)).digest("hex"))
        .toBe("5d9ef670c6371aeca01ceac8b0335d4bf67274caf38e677f0b8839d800e10c73");
});
