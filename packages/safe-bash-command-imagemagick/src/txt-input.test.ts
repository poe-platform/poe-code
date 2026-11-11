import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli, runConvertCliSync } from "./index.js";

const color = `# ImageMagick pixel enumeration: 3,1,0,255,srgba
0,0: (255,0,0,255) #FF0000FF red
1,0: (30,40,50,128) #1E283280 srgba(30,40,50,0.501961)
2,0: (70,80,90,0) #46505A00 srgba(70,80,90,0)
`;
const gray = `# ImageMagick pixel enumeration: 3,1,0,65535,gray
0,0: (4660) #123412341234 gray(7.1107%)
1,0: (4661) #123512351235 gray(7.11223%)
2,0: (65535) #FFFFFFFFFFFF gray(255)
`;
// ImageMagick 7 native output from PPM pixels 208040ff2200, -colorspace RGB txt:-.
const linear = `# ImageMagick pixel enumeration: 2,1,0,255,rgb
0,0: (4,55,13)  #04370D  rgb(1.44438%,21.5861%,5.12695%)
1,0: (255,4,0)  #FF0400  rgb(100%,1.59963%,0%)
`;
for (const mode of ["buffered", "retained", "sync"] as const) {
  it(`places reordered TXT pixels at their coordinates via ${mode}`, async () => {
    const bytes = new TextEncoder().encode("# ImageMagick pixel enumeration: 2,1,0,255,srgb\n1,0: (0,0,255)\n0,0: (255,0,0)\n");
    const files = new Map([["/in.txt", bytes]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.txt", bytes);
    const args = ["/in.txt", "-depth", "16", "-endian", "MSB", "rgb:/pix.raw"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/pix.raw") : files.get("/pix.raw")!;
    expect([...output]).toEqual([255,255,0,0,0,0,0,0,0,0,255,255]);
  });
  it(`decodes native linear RGB TXT via ${mode}`, async () => {
    const bytes = new TextEncoder().encode(linear);
    const files = new Map([["/native.txt", bytes]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/native.txt", bytes);
    const args = ["/native.txt", "-colorspace", "sRGB", "-depth", "8", "rgb:/out.raw"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
    expect([...output]).toEqual([34, 128, 64, 255, 34, 0]);
  });
}
for (const mode of ["buffered", "retained", "sync"] as const) {
  for (const prefix of ["", "txt:"]) {
    it(`reads native TXT sequence with ${prefix || "signature"} via ${mode}`, async () => {
      const bytes = new TextEncoder().encode(color + gray);
      const files = new Map([["/native.dat", bytes]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/native.dat", bytes);
      const args = [prefix + "/native.dat", "/out-%d.png"];
      const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      const read = async (path: string) => mode === "retained" ? await filesystem.readFile(path) as Uint8Array : files.get(path)!;
      expect(Array.from(decodeImage(await read("/out-0.png")).data)).toEqual([255,0,0,255,30,40,50,128,70,80,90,0]);
      expect(Array.from(decodeImage(await read("/out-1.png")).data16!)).toEqual([4660,4660,4660,65535,4661,4661,4661,65535,65535,65535,65535,65535]);
      expect(mode === "retained" ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()].map(path => path.slice(1))).toEqual(["native.dat", "out-0.png", "out-1.png"]);
    });
  }
}

for (const retained of [false, true]) {
  it(`reads one TXT image from stdin and selects a sequence page (${retained ? "retained" : "buffered"})`, async () => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const input = retained ? { filesystem, cwd: "/" } : files;
    const read = async (path: string) => retained ? await filesystem.readFile(path) as Uint8Array : files.get(path)!;
    expect(await runConvertCli(["txt:-", "/single.png"], input, new TextEncoder().encode(color))).toMatchObject({ exitCode: 0 });
    expect(Array.from(decodeImage(await read("/single.png")).data)).toEqual([255,0,0,255,30,40,50,128,70,80,90,0]);
    expect(await runConvertCli(["txt:-[1]", "/selected.png"], input, new TextEncoder().encode(color + gray))).toMatchObject({ exitCode: 0 });
    expect(decodeImage(await read("/selected.png")).data16?.[0]).toBe(4660);
  });
}
