import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const data = Uint8Array.from(Array.from({ length: 64 * 48 }, (_, i) => {
  const x = i % 64, y = Math.floor(i / 64);
  return [(x * 17 + y * 7) % 256, (x * 13 + y * 23) % 256, (x * 9 + y * 11) % 256, x % 7 === 0 ? 0 : (x * 5 + y * 11) % 256];
}).flat());
const input = encodeImage({ format: "png", width: 64, height: 48, data, channels: 4, depth: "uchar", space: "srgb", hasAlpha: true, density: 72 }, { format: "png" }).data;

for (const retained of [false, true]) for (const write of [false, true]) {
  it(`targets WebP size while preserving dimensions and alpha (retained=${retained}, write=${write})`, async () => {
    const files = new Map([["/in.png", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const outputs: Uint8Array[] = [];
    for (const args of [[], ["-define", "webp:target-size=600"], ["-define", "webp:target-size=1200"], ["-define", "webp:target-size=600", "+define", "webp:target-size"], ["-define", "webp:target-size=2000"]]) {
      const result = await runConvertCli(["/in.png", ...args, "-define", "webp:pass=6", ...(write ? ["-write", "/out.webp", "null:"] : ["/out.webp"])], retained ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = retained ? await filesystem.readFile("/out.webp") : files.get("/out.webp")!;
      const decoded = decodeImage(output);
      expect(decoded).toMatchObject({ width: 64, height: 48 });
      expect(decoded.data.filter((_, i) => i % 4 === 3)).toEqual(data.filter((_, i) => i % 4 === 3));
      outputs.push(output);
    }
    // The portable encoder's minimum for this alpha fixture exceeds 1200 bytes.
    expect(outputs[1]!.length).toBeLessThanOrEqual(outputs[2]!.length);
    expect(outputs[2]!.length).toBeLessThan(outputs[4]!.length);
    expect(Math.abs(outputs[4]!.length - 2000)).toBeLessThan(200);
    expect(Math.abs(outputs[1]!.length - 600)).toBeLessThan(Math.abs(outputs[0]!.length - 600));
    expect(Math.abs(outputs[2]!.length - 1200)).toBeLessThan(Math.abs(outputs[0]!.length - 1200));
    expect(outputs[3]).toEqual(outputs[0]);
  });
}

for (const define of ["webp:target-size=-1", "webp:target-size=1.5", "webp:target-size=2147483648", "webp:target-size=", "webp:pass=0", "webp:pass=11", "webp:pass=1.5", "webp:pass=no"]) {
  it(`rejects invalid ${define}`, async () => {
    const result = await runConvertCli(["-size", "1x1", "xc:red", "-define", define, "/out.webp"], new Map());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`${define.split("=")[0]} must be an integer`);
  });
}

for (const retained of [false, true]) {
  it(`disables targeting with zero and preserves explicit lossless (retained=${retained})`, async () => {
    const files = new Map([["/in.png", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const run = async (args: string[]) => {
      expect(await runConvertCli(["/in.png", ...args, "/out.webp"], retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
      return retained ? filesystem.readFile("/out.webp") : files.get("/out.webp")!;
    };
    expect(await run(["-define", "webp:target-size=0"])).toEqual(await run([]));
    expect(await run(["-define", "webp:lossless=true", "-define", "webp:target-size=600"])).toEqual(await run(["-define", "webp:lossless=true"]));
    expect(await run(["-define", "webp:target-size=1200", "-define", "webp:pass=1", "+define", "webp:pass"])).toEqual(await run(["-define", "webp:target-size=1200"]));
    expect(await run(["-define", "webp:target-size=1200", "-define", "webp:pass=1"])).toEqual(await run([]));
  });
}

for (const retained of [false, true]) {
  it(`captures intermediate targets and encodes every animation frame (retained=${retained})`, async () => {
    const files = new Map([["/in.png", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const result = await runConvertCli([
      "-delay", "7", "/in.png", "(", "-delay", "19", "/in.png", "-channel", "RGB", "-negate", "+channel", ")", "-loop", "3",
      "-define", "webp:target-size=3000", "-write", "/small.webp",
      "-define", "webp:target-size=5000", "/large.webp"
    ], retained ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const small = retained ? await filesystem.readFile("/small.webp") : files.get("/small.webp")!;
    const large = retained ? await filesystem.readFile("/large.webp") : files.get("/large.webp")!;
    expect(small.length).toBeLessThan(large.length);
    for (const bytes of [small, large]) for (const page of [0, 1]) {
      const decoded = decodeImage(bytes, { page });
      expect(decoded).toMatchObject({ width: 64, height: 48, delay: [70, 190], loop: 3 });
      expect(decoded.data.filter((_, i) => i % 4 === 3)).toEqual(data.filter((_, i) => i % 4 === 3));
    }
  });
}
